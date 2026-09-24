import { html, useEffect, useState } from '../../html.js';
import { t } from '../../i18n/index.js';
import { api, errorText } from '../../api.js';
import { refreshSession } from '../../state/session.js';
import { Badge, Button, Icon, Meter, Select, SkeletonList } from '../../components/ui.js';
import { confirm } from '../../components/overlay.js';
import { toast } from '../../components/toast.js';
import { fmtBytes, fmtNumber } from '../../time.js';

const AGES = [0, 14, 30, 60, 90];

/**
 * The cleanup tools (§7.5). Each previews the count and exact bytes before
 * running, and asks for confirmation.
 */
const TOOLS = /** @type {const} */ ([
  { id: 'past-entries', icon: 'calendar-days', ages: AGES, defaultAge: 90 },
  { id: 'past-covers', icon: 'image', ages: null, defaultAge: 0 },
  { id: 'post-media', icon: 'images', ages: [30, 60, 90, 180, 365], defaultAge: 90 },
  { id: 'unreferenced', icon: 'trash-2', ages: null, defaultAge: 0 },
  { id: 'guest-names', icon: 'user-x', ages: [30, 90, 180, 365], defaultAge: 180 },
]);

export function Storage() {
  const [data, setData] = useState(/** @type {any} */ (null));
  const load = () =>
    api('GET', '/storage')
      .then(setData)
      .catch((err) => toast('danger', errorText(err.code)));
  useEffect(() => {
    load();
  }, []);
  const after = () => (load(), refreshSession());

  return html`<div class="stack storage-page">
    <div class="page-head">
      <h1>${t('admin.storage')}</h1>
      <p class="page-sub">${t('admin.storageIntro')}</p>
    </div>
    ${data === null
      ? html`<${SkeletonList} rows=${4} />`
      : html`
        <${Usage} data=${data} />
        <section class="card" aria-labelledby="st-tools">
          <div class="card-head"><h2 id="st-tools">${t('admin.cleanupTools')}</h2></div>
          <ul class="cleanup-list" role="list">
            ${TOOLS.map((tool) => html`<li><${CleanupTool} tool=${tool} onDone=${after} /></li>`)}
          </ul>
        </section>
        <${Largest} files=${data.largest} />`}
  </div>`;
}

/** @param {{data: any}} p */
function Usage({ data }) {
  const b = data.breakdown;
  const parts = [
    { key: 'covers', bytes: b.covers },
    { key: 'posts', bytes: b.posts },
    { key: 'other', bytes: b.other },
    { key: 'unreferenced', bytes: b.unreferenced },
    { key: 'database', bytes: b.database },
  ];
  const pct = Math.round(data.pct * 1000) / 10;
  return html`<section class="card" aria-labelledby="st-usage">
    <div class="card-head">
      <h2 id="st-usage">${t('admin.storageUsage')}</h2>
      ${data.level && html`<${Badge} tone=${data.level === 'warn' ? 'warning' : 'danger'}>${t(`admin.storageLevel_${data.level}`)}</${Badge}>`}
    </div>
    <div class="card-body stack">
      <div class="storage-total">
        <span class="stat-value num">${fmtNumber(pct)}%</span>
        <span class="muted">${t('admin.storageUsed', { used: fmtBytes(data.used), cap: fmtBytes(data.cap) })}</span>
      </div>
      <${Meter} value=${data.pct} label=${t('admin.storage')} level=${data.level} />
      <div class="storage-bar" aria-hidden="true">
        ${parts.map((p) => p.bytes > 0 && html`<span data-part=${p.key} style=${{ flexGrow: String(p.bytes) }}></span>`)}
      </div>
      <dl class="storage-breakdown">
        ${parts.map((p) => html`<div data-part=${p.key}>
          <dt><i aria-hidden="true"></i>${t(`admin.part_${p.key}`)}</dt>
          <dd class="num">${fmtBytes(p.bytes)}</dd>
        </div>`)}
      </dl>
      <p class="small muted">${t('admin.storageFiles', { n: data.files })}</p>
    </div>
  </section>`;
}

/** @param {{tool: typeof TOOLS[number], onDone: () => void}} p */
function CleanupTool({ tool, onDone }) {
  const [age, setAge] = useState(String(tool.defaultAge));
  const [preview, setPreview] = useState(/** @type {{count: number, bytes: number}|null} */ (null));
  const [busy, setBusy] = useState(/** @type {string|null} */ (null));
  const body = tool.ages ? { olderThanDays: Number(age) } : {};
  useEffect(() => setPreview(null), [age]);

  async function run(/** @type {boolean} */ dryRun) {
    if (!dryRun) {
      const ok = await confirm({
        title: t(`admin.tool_${tool.id}`),
        message: t('admin.cleanupConfirm', { n: preview?.count ?? 0, size: fmtBytes(preview?.bytes ?? 0) }),
        confirmLabel: t('admin.cleanupRun'),
        danger: true,
      });
      if (!ok) return;
    }
    setBusy(dryRun ? 'preview' : 'run');
    try {
      const r = await api('POST', `/storage/cleanup/${tool.id}`, { query: dryRun ? { dryRun: '1' } : {}, body });
      if (dryRun) setPreview(r);
      else {
        toast('success', t('admin.cleanupDone', { n: r.count, size: fmtBytes(r.bytes) }));
        setPreview(null);
        onDone();
      }
    } catch (/** @type {any} */ err) {
      toast('danger', errorText(err.code));
    } finally {
      setBusy(null);
    }
  }

  const id = `tool-${tool.id}`;
  return html`<div class="cleanup-tool" aria-labelledby=${id} role="group">
    <${Icon} name=${tool.icon} class="cleanup-icon" />
    <div class="cleanup-main">
      <h3 id=${id} class="cleanup-title">${t(`admin.tool_${tool.id}`)}</h3>
      <p class="small muted">${t(`admin.toolHint_${tool.id}`)}</p>
      ${tool.ages && html`<${Select} value=${age} onChange=${setAge} aria-label=${t('admin.olderThan')} class="cleanup-age"
        options=${tool.ages.map((d) => ({ value: String(d), label: d === 0 ? t('admin.allPast') : t('admin.olderThanDays', { n: d }) }))} />`}
      ${preview && html`<p class="cleanup-preview small" role="status">
        ${preview.count === 0 ? t('admin.cleanupNothing') : t('admin.cleanupPreview', { n: preview.count, size: fmtBytes(preview.bytes) })}</p>`}
    </div>
    <div class="cleanup-actions">
      <${Button} size="sm" busy=${busy === 'preview'} onClick=${() => run(true)}>${t('admin.cleanupPreviewBtn')}</${Button}>
      <${Button} size="sm" variant="danger" busy=${busy === 'run'} disabled=${!preview || preview.count === 0} onClick=${() => run(false)}>
        ${t('admin.cleanupRun')}</${Button}>
    </div>
  </div>`;
}

/** @param {{files: any[]}} p */
function Largest({ files }) {
  return html`<section class="card" aria-labelledby="st-largest">
    <div class="card-head"><h2 id="st-largest">${t('admin.largestFiles')}</h2></div>
    ${files.length === 0
      ? html`<div class="card-body"><p class="muted">${t('admin.noFiles')}</p></div>`
      : html`<div class="table-wrap" tabindex="0" role="region" aria-label=${t('admin.largestFiles')}>
          <table class="table largest-table">
            <thead><tr>
              <th scope="col">${t('admin.file')}</th><th scope="col">${t('admin.size')}</th><th scope="col">${t('admin.usedIn')}</th>
            </tr></thead>
            <tbody>
              ${files.map((f) => html`<tr>
                <td><span class="file-cell">
                  <span class="file-thumb">${f.thumb_url ? html`<img src=${f.thumb_url} alt="" loading="lazy" />` : html`<${Icon} name=${f.kind === 'video' ? 'video' : 'image'} />`}</span>
                  <a href=${f.url} target="_blank" rel="noopener" class="truncate">${f.original_name ?? f.id}</a>
                </span></td>
                <td class="num nowrap">${fmtBytes(f.total_bytes)}</td>
                <td>${usageLinks(f)}</td>
              </tr>`)}
            </tbody>
          </table>
        </div>`}
  </section>`;
}

/** @param {any} f */
function usageLinks(f) {
  const u = f.usages;
  const links = [
    ...u.entries.map((/** @type {any} */ e) => html`<a href=${`/entries/${e.id}`}><${Icon} name="ticket" />${e.title}</a>`),
    ...u.posts.map((/** @type {any} */ p) => html`<a href=${`/social?post=${p.id}`}><${Icon} name="megaphone" />${p.title}</a>`),
    ...u.platforms.map((/** @type {any} */ p) => html`<a href="/social/platforms"><${Icon} name="layers" />${p.title}</a>`),
  ];
  if (!links.length) return f.unreferenced ? html`<${Badge} tone="warning">${t('admin.unreferenced')}</${Badge}>` : html`<span class="muted">—</span>`;
  return html`<span class="usage-links">${links}</span>`;
}

