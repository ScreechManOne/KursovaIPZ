import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { api } from '../api.js';
import { navigate } from '../router.js';
import { CollabClient } from '../collab/CollabClient.js';
import { transformIndex } from '../../../shared/ot.js';
import { renderMarkdown, lineOf, countWords } from '../markdown.js';
import { Header, Avatar, Modal, ROLE_NAMES } from '../components/common.jsx';
import { ShareDialog } from '../components/ShareDialog.jsx';
import { VersionsPanel } from '../components/VersionsPanel.jsx';

const MODES = [
  { key: 'edit', label: 'Редактор' },
  { key: 'split', label: 'Розділено' },
  { key: 'view', label: 'Перегляд' },
];

const CLOSE_REASONS = {
  deleted: 'Документ видалено власником.',
  revoked: 'Доступ до документа більше не надається.',
};

export function EditorPage({ docId }) {
  const textareaRef = useRef(null);
  const clientRef = useRef(null);
  const cursorTimer = useRef(null);

  const [doc, setDoc] = useState(null);
  const [content, setContent] = useState('');
  const [title, setTitle] = useState('');
  const [status, setStatus] = useState({ synced: true, revision: 0 });
  const [online, setOnline] = useState(false);
  const [peers, setPeers] = useState([]);
  const [mode, setMode] = useState('split');
  const [panel, setPanel] = useState(null); // 'share' | 'versions' | null
  const [versionPreview, setVersionPreview] = useState(null);
  const [notice, setNotice] = useState('');
  const [fatal, setFatal] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  const canEdit = doc && doc.role !== 'viewer';

  /** Записує текст у textarea, зберігаючи виділення користувача. */
  const writeToTextarea = useCallback((text, op) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const { selectionStart, selectionEnd, scrollTop } = ta;
    ta.value = text;
    if (op && document.activeElement === ta) {
      ta.setSelectionRange(transformIndex(selectionStart, op), transformIndex(selectionEnd, op));
    }
    ta.scrollTop = scrollTop;
  }, []);

  useEffect(() => {
    let client;
    let cancelled = false;
    api.getDocument(docId)
      .then(({ document }) => {
        if (cancelled) return;
        setDoc(document);
        setTitle(document.title);
        setContent(document.content);
        setStatus({ synced: true, revision: document.revision });
        writeToTextarea(document.content);

        client = new CollabClient({
          docId,
          content: document.content,
          revision: document.revision,
          handlers: {
            onRemoteChange: (text, op) => {
              writeToTextarea(text, op);
              setContent(text);
              setPeers((list) => list.map((p) => ({ ...p, cursor: transformIndex(p.cursor, op) })));
            },
            onReset: (text) => { writeToTextarea(text); setContent(text); },
            onStatus: setStatus,
            onConnection: setOnline,
            onPresence: setPeers,
            onCursor: (clientId, cursor) => setPeers((list) => list.map((p) => (p.clientId === clientId ? { ...p, cursor } : p))),
            onTitle: setTitle,
            onError: (msg) => setNotice(`Зміни не вдалося застосувати: ${msg}. Документ синхронізовано повторно.`),
            onClosed: (reason) => {
              if (reason === 'role-changed') setReloadKey((k) => k + 1);
              else setFatal(CLOSE_REASONS[reason] || 'З\'єднання з документом закрито.');
            },
          },
        });
        clientRef.current = client;
        client.connect();
      })
      .catch((e) => setFatal(e.status === 404 ? 'Документ не знайдено або доступ до нього відсутній.' : e.message));

    return () => {
      cancelled = true;
      client?.close();
    };
  }, [docId, reloadKey, writeToTextarea]);

  function onInput(e) {
    const text = e.target.value;
    clientRef.current?.applyLocal(text);
    setContent(text);
    reportCursor();
  }

  /** Позиція курсора надсилається не частіше ніж раз на 250 мс. */
  function reportCursor() {
    clearTimeout(cursorTimer.current);
    cursorTimer.current = setTimeout(() => {
      const ta = textareaRef.current;
      if (ta && clientRef.current) clientRef.current.sendCursor(ta.selectionStart);
    }, 250);
  }

  async function saveTitle() {
    const clean = title.trim();
    if (!clean || clean === doc.title) { setTitle(doc.title); return; }
    try {
      await api.renameDocument(docId, clean);
      setDoc({ ...doc, title: clean });
    } catch (e) {
      setNotice(e.message);
      setTitle(doc.title);
    }
  }

  function exportMarkdown() {
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${title.replace(/[\\/:*?"<>|]+/g, '_') || 'document'}.md`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const html = useMemo(() => renderMarkdown(content), [content]);

  if (fatal) {
    return (
      <>
        <Header />
        <main className="page"><div className="empty"><p>{fatal}</p><a className="btn" href="#/documents">До списку документів</a></div></main>
      </>
    );
  }

  return (
    <div className="editor-shell">
      <Header>
        {doc && (
          <div className="doc-title-bar">
            <button className="btn btn-ghost" onClick={() => navigate('/documents')} aria-label="Назад">←</button>
            <input
              className="title-input" value={title} disabled={!canEdit} maxLength={120}
              onChange={(e) => setTitle(e.target.value)} onBlur={saveTitle}
              onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} aria-label="Назва документа"
            />
            <span className={`badge badge-${doc.role}`}>{ROLE_NAMES[doc.role]}</span>
          </div>
        )}
      </Header>

      <div className="editor-toolbar">
        <div className="tabs">
          {MODES.map((m) => (
            <button key={m.key} className={mode === m.key ? 'tab active' : 'tab'} onClick={() => setMode(m.key)}>{m.label}</button>
          ))}
        </div>
        <div className="peers">
          {peers.map((p) => (
            <span key={p.clientId} className="peer" style={{ borderColor: p.color }}>
              <Avatar name={p.name} color={p.color} size={24} />
              <span>{p.name}</span>
              <span className="muted small">рядок {lineOf(content, p.cursor)}</span>
            </span>
          ))}
          {peers.length === 0 && <span className="muted small">Зараз у документі лише ви</span>}
        </div>
        <div className="toolbar-actions">
          <button className="btn" onClick={() => setPanel(panel === 'versions' ? null : 'versions')}>Версії</button>
          <button className="btn" onClick={exportMarkdown}>Експорт .md</button>
          <button className="btn btn-primary" onClick={() => setPanel('share')}>Поділитися</button>
        </div>
      </div>

      {notice && <div className="alert alert-inline" onClick={() => setNotice('')}>{notice}</div>}
      {doc && !canEdit && <div className="alert alert-info">Ви переглядаєте документ у ролі читача — редагування недоступне.</div>}

      <div className={`editor-body mode-${mode}`}>
        <textarea
          ref={textareaRef}
          className="editor-input"
          onInput={onInput}
          onSelect={reportCursor}
          readOnly={!canEdit}
          spellCheck={false}
          placeholder={canEdit ? 'Почніть писати… Підтримується розмітка Markdown: # заголовок, **жирний**, - список' : ''}
          aria-label="Текст документа"
        />
        <article className="editor-preview markdown" dangerouslySetInnerHTML={{ __html: html }} />
        {panel === 'versions' && (
          <VersionsPanel docId={docId} canEdit={canEdit} onClose={() => setPanel(null)} onPreview={setVersionPreview} />
        )}
      </div>

      <footer className="statusbar">
        <span className={online ? 'conn ok' : 'conn bad'}>{online ? '● Підключено' : '● Немає з\'єднання, повторне підключення…'}</span>
        <span>{status.synced ? 'Усі зміни збережено' : 'Синхронізація…'}</span>
        <span>Ревізія {status.revision}</span>
        <span>{countWords(content)} слів · {content.length} символів</span>
      </footer>

      {panel === 'share' && <ShareDialog docId={docId} isOwner={doc?.role === 'owner'} onClose={() => setPanel(null)} />}
      {versionPreview && (
        <Modal title={`Версія «${versionPreview.label}»`} onClose={() => setVersionPreview(null)} wide>
          <article className="markdown version-preview" dangerouslySetInnerHTML={{ __html: renderMarkdown(versionPreview.content) }} />
        </Modal>
      )}
    </div>
  );
}
