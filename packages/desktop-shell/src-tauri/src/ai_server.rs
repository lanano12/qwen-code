//! Loopback control for the local halogen-flash server.
//! The Web Shell calls this from the AI Server page. It is bound to
//! 127.0.0.1 only and is not the model server itself.

use serde_json::{json, Value};
use std::fs::OpenOptions;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::thread;
use std::time::Duration;

const CONTROL_ADDR: &str = "127.0.0.1:8742";
const HEALTH_URL: &str = "http://127.0.0.1:8731/health";
const ENDPOINT: &str = "http://127.0.0.1:8731/v1";
const CONTAINER: &str = "halogen-flash";
const SERVE_SCRIPT: &str = "/ML_AI/AILeeMnq/scripts/serve-halogen-flash.sh";
const LOG_PATH: &str = "/tmp/halogen-flash-gui.log";

struct Control {
    child: Mutex<Option<std::process::Child>>,
}

pub fn spawn() {
    thread::spawn(|| {
        let control = Control {
            child: Mutex::new(None),
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
                let body = match (method.as_str(), path.as_str()) {
                    ("OPTIONS", _) => String::new(),
                    ("GET", "/status") => status(&control).to_string(),
                    ("POST", "/start") => start(&control).to_string(),
                    ("POST", "/stop") => stop(&control).to_string(),
                    _ => json!({ "error": "not found" }).to_string(),
                };
                let status_line = if method == "OPTIONS" {
                    "204 No Content"
                } else if path != "/status" && path != "/start" && path != "/stop" && method != "OPTIONS"
                {
                    "404 Not Found"
                } else {
                    "200 OK"
                };
                let _ = write_response(&mut stream, status_line, &body);
            }
        }
    });
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

fn status(control: &Control) -> Value {
    reap_child(control);
    let health = health();
    let container = container_state();
    let starting = child_running(control);
    let state = if health.is_some() {
        "running"
    } else if container.as_deref() == Some("running") || starting {
        "starting"
    } else {
        "stopped"
    };
    let mut body = json!({
        "state": state,
        "adopted": health.is_some() && !starting,
        "endpoint": ENDPOINT,
        "container": CONTAINER,
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
        if let Some(detail) = last_log_line() {
            if detail.contains("another server") || detail.contains("MemAvailable") || detail.contains("missing") {
                body["detail"] = json!(detail);
            }
        }
    }
    body
}

fn start(control: &Control) -> Value {
    let current = status(control);
    if current["state"] == "running" || current["state"] == "starting" {
        return current;
    }
    if !std::path::Path::new(SERVE_SCRIPT).is_file() {
        return json!({
            "state": "stopped",
            "endpoint": ENDPOINT,
            "container": CONTAINER,
            "detail": format!("missing {SERVE_SCRIPT}"),
        });
    }
    let log = match OpenOptions::new().create(true).append(true).open(LOG_PATH) {
        Ok(file) => file,
        Err(error) => {
            return json!({
                "state": "stopped",
                "detail": format!("could not open {LOG_PATH}: {error}"),
            });
        }
    };
    let err = match log.try_clone() {
        Ok(file) => file,
        Err(error) => {
            return json!({
                "state": "stopped",
                "detail": error.to_string(),
            });
        }
    };
    match Command::new("setsid")
        .arg("bash")
        .arg(SERVE_SCRIPT)
        .stdin(Stdio::null())
        .stdout(Stdio::from(log))
        .stderr(Stdio::from(err))
        .spawn()
    {
        Ok(child) => {
            *control.child.lock().unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(child);
            status(control)
        }
        Err(error) => json!({
            "state": "stopped",
            "endpoint": ENDPOINT,
            "container": CONTAINER,
            "detail": format!("could not start the server: {error}"),
        }),
    }
}

fn stop(control: &Control) -> Value {
    let _ = Command::new("podman")
        .args(["stop", "-t", "20", CONTAINER])
        .output();
    reap_child(control);
    status(control)
}

fn reap_child(control: &Control) {
    let mut child = control.child.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    if let Some(process) = child.as_mut() {
        if process.try_wait().ok().flatten().is_some() {
            *child = None;
        }
    }
}

fn child_running(control: &Control) -> bool {
    control
        .child
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .is_some()
}

fn health() -> Option<Value> {
    let output = Command::new("curl")
        .args(["-fsS", "--max-time", "2", HEALTH_URL])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    serde_json::from_slice(&output.stdout).ok()
}

fn container_state() -> Option<String> {
    let output = Command::new("podman")
        .args(["inspect", "-f", "{{.State.Status}}", CONTAINER])
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

fn last_log_line() -> Option<String> {
    let text = std::fs::read_to_string(LOG_PATH).ok()?;
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
}
