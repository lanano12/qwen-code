//! Loopback control for the local halogen servers.
//! The Web Shell calls this from the AI Server page. It is bound to
//! 127.0.0.1 only and is not a model server itself.

use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs::OpenOptions;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::thread;
use std::time::Duration;

const CONTROL_ADDR: &str = "127.0.0.1:8742";

struct ServerSpec {
    id: &'static str,
    label: &'static str,
    title: &'static str,
    container: &'static str,
    /// Names this page may stop, including a lab container on the same port.
    also_stop: &'static [&'static str],
    port: u16,
    /// "health" for halogen `/health`, "models" for llama.cpp `/v1/models`.
    probe: &'static str,
    script: &'static str,
    log: &'static str,
}

const SERVERS: &[ServerSpec] = &[
    ServerSpec {
        id: "flash",
        label: "Flash",
        title: "Qwen3.8-Flash-Next",
        container: "halogen-flash",
        also_stop: &["lab-halogen-flash"],
        port: 8731,
        probe: "health",
        script: "/ML_AI/AILeeMnq/scripts/serve-halogen-flash.sh",
        log: "/tmp/halogen-flash-gui.log",
    },
    ServerSpec {
        id: "27b",
        label: "27B",
        title: "Qwen3.8-27B",
        container: "halogen-27b",
        also_stop: &["lab-halogen-27b"],
        port: 8732,
        probe: "health",
        script: "/ML_AI/AILeeMnq/scripts/serve-halogen-27b.sh",
        log: "/tmp/halogen-27b-gui.log",
    },
    ServerSpec {
        id: "coder",
        label: "Coder",
        title: "Qwen3-Coder-30B",
        container: "",
        also_stop: &[],
        port: 8000,
        probe: "models",
        script: "/ML_AI/AILeeMnq/scripts/serve-coder.sh",
        log: "/tmp/coder-gui.log",
    },
];

struct Control {
    children: Mutex<HashMap<String, Child>>,
}

pub fn spawn() {
    thread::spawn(|| {
        let control = Control {
            children: Mutex::new(HashMap::new()),
        };
        let listener = match TcpListener::bind(CONTROL_ADDR) {
            Ok(listener) => listener,
            Err(error) => {
                eprintln!("AI Server control did not bind {CONTROL_ADDR}: {error}");
                return;
            }
        };
        for stream in listener.incoming() {
            let Ok(mut stream) = stream else {
                continue;
            };
            let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
            let _ = stream.set_write_timeout(Some(Duration::from_secs(40)));
            if let Some((method, path)) = read_request(&mut stream) {
                let (status_line, body) = dispatch(&control, &method, &path);
                let _ = write_response(&mut stream, status_line, &body);
            }
        }
    });
}

fn dispatch(control: &Control, method: &str, path: &str) -> (&'static str, String) {
    if method == "OPTIONS" {
        return ("204 No Content", String::new());
    }
    if method == "GET" && path == "/status" {
        return ("200 OK", snapshot(control).to_string());
    }
    if let Some(id) = path.strip_prefix("/start/") {
        if method == "POST" && spec(id).is_some() {
            return ("200 OK", start(control, id).to_string());
        }
    }
    if let Some(id) = path.strip_prefix("/stop/") {
        if method == "POST" && spec(id).is_some() {
            return ("200 OK", stop(control, id).to_string());
        }
    }
    ("404 Not Found", json!({ "error": "not found" }).to_string())
}

fn spec(id: &str) -> Option<&'static ServerSpec> {
    SERVERS.iter().find(|server| server.id == id)
}

fn read_request(stream: &mut TcpStream) -> Option<(String, String)> {
    let mut buffer = [0_u8; 2048];
    let n = stream.read(&mut buffer).ok()?;
    let text = String::from_utf8_lossy(&buffer[..n]);
    let line = text.lines().next()?;
    let mut parts = line.split_whitespace();
    let method = parts.next()?.to_string();
    let path = parts.next()?.split('?').next()?.to_string();
    Some((method, path))
}

fn write_response(stream: &mut TcpStream, status: &str, body: &str) -> std::io::Result<()> {
    let response = format!(
        "HTTP/1.1 {status}\r\n\
         Access-Control-Allow-Origin: *\r\n\
         Access-Control-Allow-Private-Network: true\r\n\
         Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n\
         Access-Control-Allow-Headers: Content-Type\r\n\
         Content-Type: application/json\r\n\
         Content-Length: {}\r\n\
         Connection: close\r\n\
         \r\n\
         {body}",
        body.len()
    );
    stream.write_all(response.as_bytes())
}

fn snapshot(control: &Control) -> Value {
    reap_children(control);
    json!({
        "servers": SERVERS.iter().map(|server| one_status(control, server)).collect::<Vec<_>>(),
    })
}

fn one_status(control: &Control, server: &ServerSpec) -> Value {
    let health = probe(server);
    let container = if server.container.is_empty() {
        None
    } else {
        container_state(server.container)
    };
    let starting = child_running(control, server.id);
    let state = if health.is_some() {
        "running"
    } else if container.as_deref() == Some("running") || starting {
        "starting"
    } else {
        "stopped"
    };
    let mut body = json!({
        "id": server.id,
        "label": server.label,
        "title": server.title,
        "state": state,
        "adopted": health.is_some() && !starting,
        "endpoint": format!("http://127.0.0.1:{}/v1", server.port),
        "container": server.container,
        "model": null,
        "version": null,
        "context": null,
        "detail": null,
    });
    if let Some(health) = health {
        if let Some(model) = health.get("model").and_then(Value::as_str) {
            body["model"] = json!(model);
        }
        if let Some(context) = health.get("context").and_then(Value::as_u64) {
            body["context"] = json!(context);
        }
        body["version"] = json!(version_label(&health));
    } else if state == "stopped" {
        if let Some(detail) = last_log_line(server.log) {
            if detail.contains("another server")
                || detail.contains("MemAvailable")
                || detail.contains("missing")
                || detail.contains("cannot share")
            {
                body["detail"] = json!(detail);
            }
        }
    }
    body
}

fn start(control: &Control, id: &str) -> Value {
    let Some(server) = spec(id) else {
        return snapshot(control);
    };
    if let Some(other) = SERVERS.iter().find(|other| {
        other.id != id && {
            let state = one_status(control, other)["state"]
                .as_str()
                .unwrap_or("")
                .to_string();
            state == "running" || state == "starting"
        }
    }) {
        let mut body = snapshot(control);
        if let Some(servers) = body.get_mut("servers").and_then(Value::as_array_mut) {
            for entry in servers {
                if entry.get("id").and_then(Value::as_str) == Some(id) {
                    entry["detail"] = json!(format!(
                        "Stop {} first. These servers share one GPU.",
                        other.title
                    ));
                }
            }
        }
        return body;
    }
    let current = one_status(control, server);
    if current["state"] == "running" || current["state"] == "starting" {
        return snapshot(control);
    }
    if !std::path::Path::new(server.script).is_file() {
        return json!({
            "servers": [{
                "id": server.id,
                "label": server.label,
                "title": server.title,
                "state": "stopped",
                "detail": format!("missing {}", server.script),
            }]
        });
    }
    let log = match OpenOptions::new().create(true).append(true).open(server.log) {
        Ok(file) => file,
        Err(error) => {
            return json!({
                "servers": [{
                    "id": server.id,
                    "state": "stopped",
                    "detail": format!("could not open {}: {error}", server.log),
                }]
            });
        }
    };
    let err = match log.try_clone() {
        Ok(file) => file,
        Err(error) => {
            return json!({
                "servers": [{ "id": server.id, "state": "stopped", "detail": error.to_string() }]
            });
        }
    };
    match Command::new("setsid")
        .arg("bash")
        .arg(server.script)
        .stdin(Stdio::null())
        .stdout(Stdio::from(log))
        .stderr(Stdio::from(err))
        .spawn()
    {
        Ok(child) => {
            control
                .children
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .insert(server.id.to_string(), child);
            snapshot(control)
        }
        Err(error) => json!({
            "servers": [{
                "id": server.id,
                "state": "stopped",
                "detail": format!("could not start the server: {error}"),
            }]
        }),
    }
}

fn stop(control: &Control, id: &str) -> Value {
    let Some(server) = spec(id) else {
        return snapshot(control);
    };
    stop_container(server.container);
    for name in server.also_stop {
        stop_container(name);
    }
    stop_publisher(server.port);
    reap_children(control);
    snapshot(control)
}

fn stop_container(name: &str) {
    if name.is_empty() {
        return;
    }
    let _ = Command::new("podman")
        .args(["stop", "-t", "20", name])
        .output();
}

fn stop_publisher(port: u16) {
    let Ok(output) = Command::new("podman")
        .args(["ps", "--format", "{{.Names}}\t{{.Ports}}"])
        .output()
    else {
        return;
    };
    let Ok(text) = String::from_utf8(output.stdout) else {
        return;
    };
    let marker = format!(":{port}->");
    for line in text.lines() {
        if !line.contains(&marker) {
            continue;
        }
        if let Some(name) = line.split('\t').next() {
            if !name.is_empty() {
                stop_container(name);
            }
        }
    }
}

fn reap_children(control: &Control) {
    let mut children = control
        .children
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    children.retain(|_, child| child.try_wait().ok().flatten().is_none());
}

fn child_running(control: &Control, id: &str) -> bool {
    control
        .children
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .contains_key(id)
}

fn probe(server: &ServerSpec) -> Option<Value> {
    let path = if server.probe == "models" {
        "/v1/models"
    } else {
        "/health"
    };
    let url = format!("http://127.0.0.1:{}{path}", server.port);
    let output = Command::new("curl")
        .args(["-fsS", "--max-time", "2", &url])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let parsed: Value = serde_json::from_slice(&output.stdout).ok()?;
    if server.probe == "models" {
        models_as_health(&parsed)
    } else {
        Some(parsed)
    }
}

fn models_as_health(body: &Value) -> Option<Value> {
    let first = body.get("data")?.as_array()?.first()?;
    let model = first.get("id").and_then(Value::as_str).unwrap_or("coder");
    let meta = first.get("meta");
    let context = meta
        .and_then(|item| item.get("n_ctx"))
        .and_then(Value::as_u64)
        .or_else(|| {
            meta.and_then(|item| item.get("n_ctx_train"))
                .and_then(Value::as_u64)
        });
    let mut health = json!({
        "model": model,
        "version": "llama.cpp",
    });
    if let Some(context) = context {
        health["context"] = json!(context);
    }
    Some(health)
}

fn container_state(name: &str) -> Option<String> {
    let output = Command::new("podman")
        .args(["inspect", "-f", "{{.State.Status}}", name])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8(output.stdout).ok()?;
    let trimmed = text.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn version_label(health: &Value) -> String {
    match health.get("version") {
        Some(Value::String(version)) => version.clone(),
        Some(Value::Object(map)) => map
            .get("api")
            .and_then(Value::as_str)
            .unwrap_or("unknown")
            .to_string(),
        _ => "unknown".to_string(),
    }
}

fn last_log_line(path: &str) -> Option<String> {
    let text = std::fs::read_to_string(path).ok()?;
    text.lines()
        .rev()
        .find(|line| !line.trim().is_empty())
        .map(str::trim)
        .map(str::to_string)
}

#[cfg(test)]
mod tests {
    use super::version_label;
    use serde_json::json;

    #[test]
    fn version_label_reads_the_api_field() {
        let health = json!({"version": {"api": "0.14.0", "engine": "0.14.0"}});
        assert_eq!(version_label(&health), "0.14.0");
    }

    #[test]
    fn models_listing_becomes_a_health_record() {
        let body = json!({
            "data": [{
                "id": "coder",
                "meta": { "n_ctx": 65536 }
            }]
        });
        let health = super::models_as_health(&body).expect("model");
        assert_eq!(health["model"], "coder");
        assert_eq!(health["context"], 65536);
        assert_eq!(super::version_label(&health), "llama.cpp");
    }
}
