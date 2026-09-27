import { useCallback, useEffect, useState } from 'react';
import { useI18n } from '../../i18n';
import {
  EMPTY_AI_SERVER_LIST,
  fetchAiServer,
  type AiServerList,
  type AiServerStatus,
} from './aiServerStatus';
import styles from './AiServerPage.module.css';

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

  const run = async (id: string, action: 'start' | 'stop') => {
    setBusyId(id);
    setError(null);
    try {
      setList(await fetchAiServer(`/${action}/${id}`));
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

  return (
    <div className={styles.root}>
      <p className={styles.intro}>{t('aiServer.intro')}</p>
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
