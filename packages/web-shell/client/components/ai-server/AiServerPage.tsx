import { useCallback, useEffect, useState } from 'react';
import { useI18n } from '../../i18n';
import {
  EMPTY_AI_SERVER_LIST,
  fetchAiServer,
  type AiServerList,
  type AiServerStatus,
} from './aiServerStatus';
import styles from './AiServerPage.module.css';

function gib(bytes: number | undefined): string {
  if (!bytes || bytes <= 0) return '0.0';
  return (bytes / 1024 ** 3).toFixed(1);
}

export function AiServerPage() {
  const { t } = useI18n();
  const [list, setList] = useState<AiServerList>(EMPTY_AI_SERVER_LIST);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setList(await fetchAiServer('/status'));
      setError(null);
    } catch (cause) {
      setList(EMPTY_AI_SERVER_LIST);
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => {
      void refresh();
    }, 2000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const run = async (id: string, action: 'start' | 'stop' | 'stop-all') => {
    setBusyId(id);
    setError(null);
    try {
      const path = action === 'stop-all' ? '/stop-all' : `/${action}/${id}`;
      setList(await fetchAiServer(path));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusyId(null);
    }
  };

  const otherBusy = (server: AiServerStatus) =>
    list.servers.some(
      (other) =>
        other.id !== server.id &&
        (other.state === 'running' || other.state === 'starting'),
    );

  const anyActive = list.servers.some(
    (server) => server.state === 'running' || server.state === 'starting',
  );
  const memory = list.memory;
  const sramUsed = gib(memory?.sram_used);
  const sramTotal = gib(memory?.sram_total);
  const hostUsed = memory?.host_used ?? 0;
  const showHost = hostUsed > (memory?.sram_used ?? 0) + 4 * 1024 * 1024 * 1024;

  return (
    <div className={styles.root}>
      <p className={styles.intro}>{t('aiServer.intro')}</p>
      <div className={styles.contextBar}>
        <div className={styles.contextText}>
          <div className={styles.contextTitle}>
            {t('aiServer.sram', { used: sramUsed, total: sramTotal })}
          </div>
          {showHost ? (
            <p className={styles.detail}>
              {t('aiServer.sramHost', { used: gib(hostUsed) })}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          className={styles.secondaryButton}
          disabled={
            busyId !== null ||
            (!anyActive &&
              (memory?.sram_used ?? 0) < 64 * 1024 * 1024 &&
              hostUsed < 1024 ** 3)
          }
          onClick={() => void run('all', 'stop-all')}
        >
          {t('aiServer.stopAll')}
        </button>
      </div>
      {list.servers.map((server) => {
        const state = server.state;
        const pillClass =
          state === 'running'
            ? `${styles.pill} ${styles.pillRunning}`
            : styles.pill;
        const stateLabel =
          state === 'running'
            ? t('aiServer.state.running')
            : state === 'starting'
              ? t('aiServer.state.starting')
              : state === 'stopped'
                ? t('aiServer.state.stopped')
                : t('aiServer.state.unknown');
        const blocked = otherBusy(server);
        return (
          <section className={styles.card} key={server.id}>
            <div className={styles.cardHeader}>
              <div className={styles.cardTitle}>
                {server.title || server.id}
              </div>
              <span className={pillClass}>{stateLabel}</span>
            </div>
            <dl className={styles.rows}>
              <div className={styles.row}>
                <dt>{t('aiServer.endpoint')}</dt>
                <dd>{server.endpoint || '—'}</dd>
              </div>
              <div className={styles.row}>
                <dt>{t('aiServer.model')}</dt>
                <dd>{server.model || '—'}</dd>
              </div>
              <div className={styles.row}>
                <dt>{t('aiServer.version')}</dt>
                <dd>{server.version || '—'}</dd>
              </div>
              <div className={styles.row}>
                <dt>{t('aiServer.context')}</dt>
                <dd>{server.context ?? '—'}</dd>
              </div>
            </dl>
            <div className={styles.actions}>
              <button
                type="button"
                className={styles.primaryButton}
                disabled={
                  busyId !== null ||
                  blocked ||
                  state === 'running' ||
                  state === 'starting'
                }
                onClick={() => void run(server.id, 'start')}
              >
                {t('aiServer.start')}
              </button>
              <button
                type="button"
                className={styles.secondaryButton}
                disabled={
                  busyId !== null || state === 'stopped' || state === 'unknown'
                }
                onClick={() => void run(server.id, 'stop')}
              >
                {t('aiServer.stop')}
              </button>
            </div>
            {server.adopted ? (
              <p className={styles.detail}>{t('aiServer.alreadyRunning')}</p>
            ) : null}
            {server.detail ? (
              <p className={styles.detail}>{server.detail}</p>
            ) : null}
          </section>
        );
      })}
      {error ? (
        <p className={styles.detail}>{t('aiServer.unreachable')}</p>
      ) : null}
    </div>
  );
}
