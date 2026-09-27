import { useCallback, useEffect, useState } from 'react';
import { useI18n } from '../../i18n';
import {
  EMPTY_AI_SERVER_STATUS,
  fetchAiServer,
  type AiServerStatus,
} from './aiServerStatus';
import styles from './AiServerPage.module.css';

export function AiServerPage() {
  const { t } = useI18n();
  const [status, setStatus] = useState<AiServerStatus>(EMPTY_AI_SERVER_STATUS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await fetchAiServer('/status');
      setStatus(next);
      setError(null);
    } catch (cause) {
      setStatus(EMPTY_AI_SERVER_STATUS);
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

  const run = async (path: '/start' | '/stop') => {
    setBusy(true);
    setError(null);
    try {
      setStatus(await fetchAiServer(path));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const state = status.state;
  const pillClass =
    state === 'running' ? `${styles.pill} ${styles.pillRunning}` : styles.pill;
  const stateLabel =
    state === 'running'
      ? t('aiServer.state.running')
      : state === 'starting'
        ? t('aiServer.state.starting')
        : state === 'stopped'
          ? t('aiServer.state.stopped')
          : t('aiServer.state.unknown');

  return (
    <div className={styles.root}>
      <p className={styles.intro}>{t('aiServer.intro')}</p>
      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <div className={styles.cardTitle}>{t('aiServer.cardTitle')}</div>
          <span className={pillClass}>{stateLabel}</span>
        </div>
        <dl className={styles.rows}>
          <div className={styles.row}>
            <dt>{t('aiServer.endpoint')}</dt>
            <dd>{status.endpoint ?? 'http://127.0.0.1:8731/v1'}</dd>
          </div>
          <div className={styles.row}>
            <dt>{t('aiServer.model')}</dt>
            <dd>{status.model || '—'}</dd>
          </div>
          <div className={styles.row}>
            <dt>{t('aiServer.version')}</dt>
            <dd>{status.version || '—'}</dd>
          </div>
          <div className={styles.row}>
            <dt>{t('aiServer.context')}</dt>
            <dd>{status.context ?? '—'}</dd>
          </div>
        </dl>
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.primaryButton}
            disabled={busy || state === 'running' || state === 'starting'}
            onClick={() => void run('/start')}
          >
            {t('aiServer.start')}
          </button>
          <button
            type="button"
            className={styles.secondaryButton}
            disabled={busy || state === 'stopped' || state === 'unknown'}
            onClick={() => void run('/stop')}
          >
            {t('aiServer.stop')}
          </button>
        </div>
        {status.adopted ? (
          <p className={styles.detail}>{t('aiServer.alreadyRunning')}</p>
        ) : null}
        {status.detail ? (
          <p className={styles.detail}>{status.detail}</p>
        ) : null}
        {error ? (
          <p className={styles.detail}>{t('aiServer.unreachable')}</p>
        ) : null}
      </section>
    </div>
  );
}
