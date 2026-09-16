// ==UserScript==
// @name         Bilibili 本地时间轴跳转
// @namespace    https://github.com/AliubYiero/Yiero_WebScripts
// @version      2.5.1
// @description  导入本地时间轴、跳转视频，并将截图与截图时间线保存到本地文件夹。
// @author       Codex
// @match        https://www.bilibili.com/video/*
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// @noframes
// ==/UserScript==

(function () {
    'use strict';

    const STORAGE_KEY = 'codex-bilibili-local-timeline-v1';
    const DIRECTORY_DB_NAME = 'codex-bilibili-local-timeline';
    const DIRECTORY_STORE_NAME = 'settings';
    const DIRECTORY_KEY = 'root-directory';
    const PANEL_ID = 'codex-bilibili-local-timeline-panel';
    const STYLE_ID = 'codex-bilibili-local-timeline-style';
    const CAMERA_BUTTON_ID = 'codex-bilibili-local-timeline-camera';
    const CAPTURE_STATUS_ID = 'codex-bilibili-local-timeline-capture-status';
    const MANAGER_ID = 'codex-bilibili-local-timeline-manager';
    const TOAST_ID = 'codex-bilibili-local-timeline-toast';
    const TIMELINE_START = '<!-- codex:timeline:start -->';
    const TIMELINE_END = '<!-- codex:timeline:end -->';
    const DEFAULT_SHORTCUT = { ctrl: true, alt: true, shift: false, key: 'c' };

    const state = { pageKey: '', pageData: null };
    let timelineCollapsed = false;
    let shortcutSettingsOpen = false;
    let rootDirectoryHandle = null;
    let managerState = null;
    let lightboxState = null;

    function getStorage() {
        let value;
        try {
            value = typeof GM_getValue === 'function'
                ? GM_getValue(STORAGE_KEY, null)
                : window.localStorage.getItem(STORAGE_KEY);
        } catch (error) {
            console.warn('[本地时间轴] 读取存储失败', error);
        }
        if (typeof value === 'string') {
            try { value = JSON.parse(value); } catch (error) { value = null; }
        }
        if (!value || typeof value !== 'object' || !value.pages || typeof value.pages !== 'object') {
            return { version: 1, pages: {} };
        }
        return value;
    }

    function setStorage(value) {
        try {
            if (typeof GM_setValue === 'function') GM_setValue(STORAGE_KEY, value);
            else window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
            return true;
        } catch (error) {
            console.error('[本地时间轴] 保存失败', error);
            window.alert('时间轴保存失败，可能是脚本存储空间不足。');
            return false;
        }
    }

    function getShortcut() {
        const shortcut = getStorage().shortcut;
        if (!shortcut || typeof shortcut !== 'object') return { ...DEFAULT_SHORTCUT };
        const key = String(shortcut.key || '').toLowerCase();
        if (!/^[a-z0-9]$/.test(key)) return { ...DEFAULT_SHORTCUT };
        return {
            ctrl: shortcut.ctrl === true,
            alt: shortcut.alt === true,
            shift: shortcut.shift === true,
            key,
        };
    }

    function formatShortcut(shortcut = getShortcut()) {
        const parts = [];
        if (shortcut.ctrl) parts.push('Ctrl');
        if (shortcut.alt) parts.push('Alt');
        if (shortcut.shift) parts.push('Shift');
        parts.push(String(shortcut.key || '').toUpperCase());
        return parts.join(' + ');
    }

    function saveShortcutFromPanel(panel) {
        const keyInput = panel.querySelector('[data-shortcut-key]');
        const key = String(keyInput?.value || '').trim().toLowerCase();
        const ctrl = Boolean(panel.querySelector('[data-shortcut-modifier="ctrl"]')?.checked);
        const alt = Boolean(panel.querySelector('[data-shortcut-modifier="alt"]')?.checked);
        const shift = Boolean(panel.querySelector('[data-shortcut-modifier="shift"]')?.checked);
        if (!/^[a-z0-9]$/.test(key)) {
            window.alert('按键请填写一个英文字母或数字。');
            keyInput?.focus();
            return;
        }
        if (!ctrl && !alt && !shift) {
            window.alert('至少选择 Ctrl、Alt、Shift 中的一个。');
            return;
        }
        const storage = getStorage();
        storage.shortcut = { ctrl, alt, shift, key };
        if (!setStorage(storage)) return;
        shortcutSettingsOpen = false;
        render();
        showToast(`截图快捷键：${formatShortcut(storage.shortcut)}`);
    }

    function getVideoId() {
        const match = window.location.pathname.match(/\/video\/(BV[\w]+|av\d+)/i);
        return match ? match[1] : window.location.pathname;
    }

    function getPartNumber() {
        const part = Number(new URL(window.location.href).searchParams.get('p'));
        return Number.isInteger(part) && part > 0 ? part : 1;
    }

    function getPageKey() {
        return `${getVideoId().toLowerCase()}:p=${getPartNumber()}`;
    }

    function getVideoTitle() {
        const heading = document.querySelector('h1.video-title, .video-title, h1');
        const title = heading && heading.textContent ? heading.textContent.trim() : '';
        if (title) return title;
        return document.title.replace(/\s*[-|｜]\s*哔哩哔哩.*$/i, '').trim() || '未命名视频';
    }

    function sanitizeFileName(name) {
        return (String(name || '')
            .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
            .replace(/[. ]+$/g, '').trim().slice(0, 80)) || '未命名视频';
    }

    function getVideoFolderName() {
        return `${sanitizeFileName(getVideoTitle())} [${getVideoId().toUpperCase()}]`;
    }

    function getVideo() {
        const videos = Array.from(document.querySelectorAll('video'));
        return videos.find((video) => video.offsetWidth > 0 && video.offsetHeight > 0) || videos[0] || null;
    }

    function parseTime(value) {
        if (typeof value === 'number' && Number.isFinite(value)) return value;
        if (typeof value !== 'string') return NaN;
        const text = value.trim().replace(',', '.');
        if (/^\d+(?:\.\d+)?$/.test(text)) return Number(text);
        const parts = text.split(':');
        if (parts.length !== 3) return NaN;
        const hours = Number(parts[0]);
        const minutes = Number(parts[1]);
        const seconds = Number(parts[2]);
        return [hours, minutes, seconds].every(Number.isFinite) ? hours * 3600 + minutes * 60 + seconds : NaN;
    }

    function cleanText(value) {
        return String(value || '').replace(/\{[^}]*\}/g, '').replace(/\\N/g, '\n').replace(/<[^>]*>/g, '').trim();
    }

    function normalizeItems(items) {
        return items.map((item, index) => {
            const from = parseTime(item.from ?? item.start ?? item.startTime);
            const to = parseTime(item.to ?? item.end ?? item.endTime);
            return { id: Number.isFinite(Number(item.id)) ? Number(item.id) : index + 1, from, to: Number.isFinite(to) ? to : from, content: cleanText(item.content ?? item.text ?? item.title) };
        }).filter((item) => Number.isFinite(item.from) && item.from >= 0 && Number.isFinite(item.to) && item.to >= item.from && item.content).sort((a, b) => a.from - b.from);
    }

    function parseSrt(text) {
        const blocks = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim().split(/\n\s*\n/);
        const items = [];
        for (const block of blocks) {
            const lines = block.split('\n');
            const timeIndex = lines.findIndex((line) => line.includes('-->'));
            if (timeIndex < 0) continue;
            const [from, to] = lines[timeIndex].split(/\s*-->\s*/);
            items.push({ id: Number(lines[0]) || items.length + 1, from, to, content: lines.slice(timeIndex + 1).join('\n') });
        }
        return normalizeItems(items);
    }

    function parseAss(text) {
        const items = [];
        for (const line of text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n')) {
            if (!/^Dialogue\s*:/i.test(line)) continue;
            const fields = [];
            let rest = line.replace(/^Dialogue\s*:\s*/i, '');
            for (let index = 0; index < 9; index += 1) {
                const comma = rest.indexOf(',');
                if (comma < 0) break;
                fields.push(rest.slice(0, comma));
                rest = rest.slice(comma + 1);
            }
            fields.push(rest);
            if (fields.length >= 10) items.push({ id: items.length + 1, from: fields[1], to: fields[2], content: fields[9] });
        }
        return normalizeItems(items);
    }

    function parseJson(text) {
        const data = JSON.parse(text);
        const items = Array.isArray(data) ? data : data && data.items;
        if (!Array.isArray(items)) throw new Error('JSON 应为时间轴数组，或包含 items 数组。');
        return normalizeItems(items);
    }

    async function parseFile(file) {
        const text = await file.text();
        const extension = file.name.split('.').pop().toLowerCase();
        if (extension === 'ass') return parseAss(text);
        if (extension === 'json') return parseJson(text);
        return parseSrt(text);
    }

    function formatTime(seconds) {
        const total = Math.max(0, Math.floor(seconds));
        const hours = Math.floor(total / 3600);
        const minutes = Math.floor((total % 3600) / 60);
        const secs = total % 60;
        const result = `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
        return hours ? `${hours}:${result}` : result;
    }

    function formatDetailedTime(seconds) {
        const totalMs = Math.max(0, Math.round(seconds * 1000));
        const hours = Math.floor(totalMs / 3600000);
        const minutes = Math.floor((totalMs % 3600000) / 60000);
        const secs = Math.floor((totalMs % 60000) / 1000);
        const milliseconds = totalMs % 1000;
        const base = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
        return milliseconds ? `${base}.${String(milliseconds).padStart(3, '0')}` : base;
    }

    function makeButton(text, action, className) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = text;
        button.dataset.action = action;
        if (className) button.className = className;
        return button;
    }

    function openDirectoryDb() {
        return new Promise((resolve, reject) => {
            const request = window.indexedDB.open(DIRECTORY_DB_NAME, 1);
            request.onupgradeneeded = () => request.result.createObjectStore(DIRECTORY_STORE_NAME);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async function loadRootDirectory() {
        try {
            const db = await openDirectoryDb();
            const value = await new Promise((resolve, reject) => {
                const request = db.transaction(DIRECTORY_STORE_NAME, 'readonly').objectStore(DIRECTORY_STORE_NAME).get(DIRECTORY_KEY);
                request.onsuccess = () => resolve(request.result || null);
                request.onerror = () => reject(request.error);
            });
            db.close();
            return value;
        } catch (error) {
            console.warn('[本地时间轴] 无法读取保存目录', error);
            return null;
        }
    }

    async function saveRootDirectory(handle) {
        const db = await openDirectoryDb();
        await new Promise((resolve, reject) => {
            const transaction = db.transaction(DIRECTORY_STORE_NAME, 'readwrite');
            transaction.objectStore(DIRECTORY_STORE_NAME).put(handle, DIRECTORY_KEY);
            transaction.oncomplete = resolve;
            transaction.onerror = () => reject(transaction.error);
        });
        db.close();
        rootDirectoryHandle = handle;
    }

    async function hasWritePermission(handle, requestPermission) {
        if (!handle || typeof handle.queryPermission !== 'function') return true;
        const options = { mode: 'readwrite' };
        let permission = await handle.queryPermission(options);
        if (permission !== 'granted' && requestPermission && handle.requestPermission) permission = await handle.requestPermission(options);
        return permission === 'granted';
    }

    async function chooseRootDirectory() {
        if (typeof window.showDirectoryPicker !== 'function') throw new Error('当前浏览器不支持文件夹保存，请使用 Chrome 或 Edge。');
        const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
        await saveRootDirectory(handle);
        return handle;
    }

    async function getWritableRoot(allowPicker) {
        if (typeof window.showDirectoryPicker !== 'function') throw new Error('当前浏览器不支持文件夹保存，请使用 Chrome 或 Edge。');
        if (!rootDirectoryHandle) rootDirectoryHandle = await loadRootDirectory();
        if (!rootDirectoryHandle) {
            if (allowPicker) return chooseRootDirectory();
            throw new Error('还没有选择保存目录。');
        }
        if (await hasWritePermission(rootDirectoryHandle, allowPicker)) return rootDirectoryHandle;
        throw new Error('保存目录权限已失效，请点击“目录”重新授权。');
    }

    async function getCurrentVideoDirectory(allowPicker) {
        const root = await getWritableRoot(allowPicker);
        const directory = await root.getDirectoryHandle(getVideoFolderName(), { create: true });
        return { root, directory };
    }

    async function readTextFile(directory, fileName) {
        try {
            const handle = await directory.getFileHandle(fileName);
            return await (await handle.getFile()).text();
        } catch (error) {
            if (error.name === 'NotFoundError') return '';
            throw error;
        }
    }

    async function writeTextFile(directory, fileName, text) {
        const handle = await directory.getFileHandle(fileName, { create: true });
        const writable = await handle.createWritable();
        await writable.write(text);
        await writable.close();
    }

    async function fileExists(directory, fileName) {
        try {
            await directory.getFileHandle(fileName);
            return true;
        } catch (error) {
            if (error.name === 'NotFoundError') return false;
            throw error;
        }
    }

    function parseScreenshotFileName(fileName) {
        const match = fileName.match(/^p(\d+)-(\d{2})-(\d{2})-(\d{2})-(\d{3})(?:-(\d+))?\.png$/i);
        if (!match) return null;
        const [, part, hours, minutes, seconds, milliseconds, duplicate] = match;
        return { fileName, part: Number(part), seconds: Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds) + Number(milliseconds) / 1000, duplicate: Number(duplicate || 0) };
    }

    function sortScreenshotEntries(entries) {
        return [...entries].sort((a, b) => a.seconds - b.seconds || a.part - b.part || a.duplicate - b.duplicate || a.fileName.localeCompare(b.fileName));
    }

    function getScreenshotSortOrder() {
        return getStorage().screenshotSortOrder === 'asc' ? 'asc' : 'desc';
    }

    function sortManagerEntries(entries, order) {
        const sorted = sortScreenshotEntries(entries);
        return order === 'asc' ? sorted : sorted.reverse();
    }

    function readManagedScreenshotEntries(markdown) {
        const match = markdown.match(new RegExp(`${TIMELINE_START}([\\s\\S]*?)${TIMELINE_END}`));
        if (!match) return [];
        const entries = [];
        for (const line of match[1].split(/\r?\n/)) {
            const lineMatch = line.match(/^\s*-\s+P(\d+)\s+\[([^\]]+)\]\(([^)]+)\)\s*$/);
            if (!lineMatch) continue;
            const parsed = parseScreenshotFileName(lineMatch[3]);
            if (parsed) entries.push({ ...parsed, displayTime: lineMatch[2] });
        }
        return sortScreenshotEntries(entries);
    }

    function createTimelineBlock(entries) {
        const lines = sortScreenshotEntries(entries).map((entry) => `- P${entry.part} [${formatDetailedTime(entry.seconds)}](${entry.fileName})`);
        return `${TIMELINE_START}\n${lines.join('\n')}\n${TIMELINE_END}`;
    }

    function mergeScreenshotTimeline(markdown, title, entries) {
        const block = createTimelineBlock(entries);
        const blockPattern = new RegExp(`${TIMELINE_START}[\\s\\S]*?${TIMELINE_END}`);
        if (blockPattern.test(markdown)) return markdown.replace(blockPattern, block);
        const prefix = markdown.trim() || `# ${title}`;
        return `${prefix}\n\n## 截图时间线\n\n${block}\n`;
    }

    async function readScreenshotTimeline(directory) {
        const markdown = await readTextFile(directory, 'timeline.md');
        return { markdown, entries: readManagedScreenshotEntries(markdown) };
    }

    async function writeScreenshotTimeline(directory, markdown, title, entries) {
        await writeTextFile(directory, 'timeline.md', mergeScreenshotTimeline(markdown, title, entries));
    }

    async function getUniqueScreenshotName(directory, seconds, part) {
        const totalMs = Math.max(0, Math.round(seconds * 1000));
        const hours = Math.floor(totalMs / 3600000);
        const minutes = Math.floor((totalMs % 3600000) / 60000);
        const secs = Math.floor((totalMs % 60000) / 1000);
        const milliseconds = totalMs % 1000;
        const prefix = `p${part}-${String(hours).padStart(2, '0')}-${String(minutes).padStart(2, '0')}-${String(secs).padStart(2, '0')}-${String(milliseconds).padStart(3, '0')}`;
        let suffix = 0;
        while (true) {
            const fileName = `${prefix}${suffix ? `-${suffix}` : ''}.png`;
            if (!(await fileExists(directory, fileName))) return fileName;
            suffix += 1;
        }
    }

    function canvasToBlob(canvas) {
        return new Promise((resolve, reject) => {
            try {
                canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('截图生成失败。')), 'image/png');
            } catch (error) { reject(error); }
        });
    }

    function installStyle() {
        const style = document.getElementById(STYLE_ID) || document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `
            #${PANEL_ID} { position:relative; z-index:2147483000; width:100%; max-height:min(70vh,680px); display:flex; flex-direction:column; color:#172033; background:#fff; border:1px solid rgba(20,30,50,.16); border-radius:10px; box-shadow:0 4px 16px rgba(0,0,0,.12); font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; overflow:hidden; margin:0 0 12px; pointer-events:auto!important; }
            #${PANEL_ID} * { box-sizing:border-box; } #${PANEL_ID} .codex-timeline-header { display:flex; align-items:center; gap:5px; padding:9px 10px; border-bottom:1px solid #edf0f5; background:#fafbfc; pointer-events:auto!important; } #${PANEL_ID} .codex-timeline-title { flex:1; min-width:0; } #${PANEL_ID} .codex-timeline-actions { display:flex; flex-wrap:wrap; justify-content:flex-end; gap:4px; pointer-events:auto!important; } #${PANEL_ID} button { position:relative; z-index:2147483001; border:0; border-radius:6px; cursor:pointer; font:inherit; pointer-events:auto!important; touch-action:manipulation; } #${PANEL_ID} .codex-timeline-action { padding:5px 7px; color:#fff; background:#00aeec; } #${PANEL_ID} .codex-timeline-action.secondary { background:#87909f; } #${PANEL_ID} button:hover { filter:brightness(.94); } #${PANEL_ID} .codex-timeline-meta { padding:9px 12px 5px; color:#667085; font-size:12px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; } #${PANEL_ID} .codex-timeline-list { overflow:auto; padding:4px 8px 10px; } #${PANEL_ID} .codex-timeline-item { display:block; width:100%; padding:7px 8px; text-align:left; color:inherit; background:transparent; } #${PANEL_ID} .codex-timeline-item:hover { background:#eef9fd; } #${PANEL_ID} .codex-timeline-time { display:inline-block; min-width:54px; margin-right:7px; color:#00aeec; font-variant-numeric:tabular-nums; } #${PANEL_ID} .codex-timeline-hint { padding:12px; color:#667085; } #${PANEL_ID}.codex-timeline-collapsed > :not(.codex-timeline-header) { display:none!important; }
            #${CAMERA_BUTTON_ID} { display:inline-flex!important; align-items:center; justify-content:center; width:36px!important; height:36px!important; margin:0 2px!important; padding:0!important; color:#fff!important; background:transparent!important; border:0!important; border-radius:4px!important; cursor:pointer; } #${CAMERA_BUTTON_ID}:hover { background:rgba(255,255,255,.16)!important; } #${CAMERA_BUTTON_ID} svg { width:20px; height:20px; fill:currentColor; } #${CAMERA_BUTTON_ID}.codex-capture-success { color:#8ff0bf!important; background:rgba(20,90,60,.28)!important; } #${CAPTURE_STATUS_ID} { display:inline-flex!important; align-items:center; max-width:220px; height:28px; margin:4px 4px 4px 0; padding:0 8px; color:#d9ffe9!important; background:rgba(20,30,30,.78)!important; border:1px solid rgba(143,240,191,.48); border-radius:4px; font:12px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; pointer-events:none; opacity:0; transition:opacity .14s ease; } #${CAPTURE_STATUS_ID}.codex-capture-status-visible { opacity:1; }
            #${MANAGER_ID} { position:fixed; inset:0; z-index:2147483647; display:flex; flex-direction:column; color:#172033; background:#f4f6f9; font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; } #${MANAGER_ID} * { box-sizing:border-box; } #${MANAGER_ID} .codex-manager-header { display:flex; align-items:center; gap:10px; padding:14px 20px; color:#fff; background:#172033; } #${MANAGER_ID} .codex-manager-title { flex:1; min-width:0; font-size:16px; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; } #${MANAGER_ID} .codex-manager-header .codex-manager-close { flex:0 0 36px; width:36px; height:36px; padding:0; color:#fff; background:transparent; border:1px solid rgba(255,255,255,.55); border-radius:6px; font-size:30px; font-weight:300; line-height:30px; cursor:pointer; } #${MANAGER_ID} .codex-manager-header .codex-manager-close:hover { background:rgba(255,255,255,.16); } #${MANAGER_ID} .codex-manager-toolbar { display:flex; flex-wrap:wrap; gap:7px; padding:10px 20px; background:#fff; border-bottom:1px solid #e3e7ed; } #${MANAGER_ID} .codex-manager-toolbar button { padding:7px 11px; color:#fff; background:#00aeec; border:0; border-radius:6px; cursor:pointer; font:inherit; } #${MANAGER_ID} .codex-manager-toolbar button.secondary { color:#172033; background:#e9edf2; } #${MANAGER_ID} .codex-manager-toolbar button.danger { background:#d64545; } #${MANAGER_ID} .codex-manager-grid { flex:1; display:grid; grid-template-columns:repeat(auto-fill,minmax(190px,1fr)); align-content:start; gap:14px; overflow:auto; padding:18px 20px 28px; } #${MANAGER_ID} .codex-manager-card { position:relative; min-width:0; padding:8px; background:#fff; border:1px solid #e1e6ed; border-radius:8px; box-shadow:0 2px 7px rgba(20,30,50,.06); } #${MANAGER_ID} .codex-manager-check { position:absolute; z-index:1; top:12px; left:12px; width:18px; height:18px; accent-color:#00aeec; } #${MANAGER_ID} .codex-manager-preview { display:block; width:100%; aspect-ratio:16/9; padding:0; overflow:hidden; color:#667085; background:#e8edf2; border:0; border-radius:5px; cursor:pointer; } #${MANAGER_ID} .codex-manager-preview img { display:block; width:100%; height:100%; object-fit:contain; background:#111; } #${MANAGER_ID} .codex-manager-missing { display:grid; height:100%; place-items:center; padding:10px; font-size:12px; } #${MANAGER_ID} .codex-manager-info { display:flex; gap:8px; align-items:baseline; padding:8px 2px 2px; } #${MANAGER_ID} .codex-manager-time { color:#00aeec; font-variant-numeric:tabular-nums; white-space:nowrap; } #${MANAGER_ID} .codex-manager-file { min-width:0; color:#667085; font-size:12px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; } #${MANAGER_ID} .codex-manager-empty { grid-column:1/-1; padding:50px 20px; text-align:center; color:#667085; }
            #${MANAGER_ID}-lightbox { position:fixed; inset:0; z-index:2147483648; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:14px; padding:20px; background:rgba(0,0,0,.88); } #${MANAGER_ID}-lightbox img { max-width:min(94vw,1500px); max-height:calc(100vh - 110px); object-fit:contain; box-shadow:0 4px 26px rgba(0,0,0,.4); } #${MANAGER_ID}-lightbox .codex-lightbox-toolbar { display:flex; align-items:center; gap:8px; } #${MANAGER_ID}-lightbox button { padding:7px 12px; color:#172033; background:#fff; border:0; border-radius:6px; cursor:pointer; font:inherit; } #${MANAGER_ID}-lightbox button.danger { color:#fff; background:#d64545; } #${MANAGER_ID}-lightbox .codex-lightbox-label { max-width:50vw; color:#fff; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
            @media(max-width:640px) { #${PANEL_ID} { top:56px; right:8px; width:min(390px,calc(100vw - 16px)); } #${MANAGER_ID} .codex-manager-header,#${MANAGER_ID} .codex-manager-toolbar,#${MANAGER_ID} .codex-manager-grid { padding-left:10px; padding-right:10px; } }
            #${PANEL_ID} { z-index:10; min-height:0; color:#18191c; background:#f1f2f3; border:0; border-radius:10px; box-shadow:none; margin:10px 0; }
            #${PANEL_ID} .codex-timeline-header { gap:6px; padding:10px 12px 8px; background:transparent; border-bottom:0; }
            #${PANEL_ID} .codex-timeline-title { color:#18191c; font-size:15px!important; font-weight:600; }
            #${PANEL_ID} .codex-timeline-actions { gap:5px; }
            #${PANEL_ID} button { z-index:11; border:1px solid transparent; font:13px/1.2 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif!important; }
            #${PANEL_ID} .codex-timeline-action { min-height:28px; padding:4px 8px; color:#61666d; background:#fff; border-color:#e3e5e7; }
            #${PANEL_ID} .codex-timeline-action:hover { color:#61666d; background:#f6f7f8; }
            #${PANEL_ID} .codex-timeline-action:active { color:#fff; background:#00aeec; border-color:#00aeec; }
            #${PANEL_ID} .codex-timeline-action:focus-visible { outline:2px solid rgba(0,174,236,.35); outline-offset:1px; }
            #${PANEL_ID} .codex-timeline-action.secondary { color:#61666d; background:#fff; border-color:#e3e5e7; }
            #${PANEL_ID} .codex-shortcut-settings { display:flex; align-items:center; flex-wrap:wrap; gap:7px; padding:8px 12px 10px; color:#61666d; background:rgba(255,255,255,.46); border-top:1px solid rgba(227,229,231,.75); }
            #${PANEL_ID} .codex-shortcut-label { margin-right:2px; font-size:13px; }
            #${PANEL_ID} .codex-shortcut-option { display:inline-flex; align-items:center; gap:3px; font-size:12px; }
            #${PANEL_ID} .codex-shortcut-option input { margin:0; accent-color:#00aeec; }
            #${PANEL_ID} .codex-shortcut-plus { color:#9499a0; }
            #${PANEL_ID} .codex-shortcut-settings > input[type="text"] { width:28px; height:26px; padding:2px 5px; color:#18191c; background:#fff; border:1px solid #e3e5e7; border-radius:5px; text-align:center; font:13px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
            #${PANEL_ID} .codex-shortcut-save, #${PANEL_ID} .codex-shortcut-cancel { min-height:26px; padding:3px 8px; }
            #${PANEL_ID} .codex-timeline-meta, #${PANEL_ID} .codex-timeline-hint { padding:4px 14px 12px; color:#61666d; background:transparent; }
            #${PANEL_ID} .codex-timeline-list { padding:2px 8px 10px; background:transparent; }
            #${PANEL_ID} .codex-timeline-item:hover { background:#f1faff; }
            #${MANAGER_ID} .codex-manager-card .codex-manager-delete-one { position:absolute; top:10px; right:10px; z-index:2; display:flex; width:28px; height:28px; align-items:center; justify-content:center; padding:0; color:#fff; background:rgba(214,69,69,.94); border:0; border-radius:50%; font-size:20px; line-height:1; cursor:pointer; opacity:0; pointer-events:none; transition:opacity .12s ease,transform .12s ease; }
            #${MANAGER_ID} .codex-manager-card:hover .codex-manager-delete-one, #${MANAGER_ID} .codex-manager-card:focus-within .codex-manager-delete-one { opacity:1; pointer-events:auto; }
            #${MANAGER_ID} .codex-manager-card .codex-manager-delete-one:hover { transform:scale(1.06); background:#d64545; }
            #${MANAGER_ID} .codex-manager-sort-label { display:inline-flex; align-items:center; gap:6px; margin-left:auto; color:#61666d; font-size:13px; }
            #${MANAGER_ID} .codex-manager-toolbar button.codex-manager-sort { height:32px; padding:0 10px; color:#172033; background:#fff; border:1px solid #dfe3e8; border-radius:6px; font:inherit; }
            #${MANAGER_ID} .codex-manager-toolbar button.codex-manager-sort:hover { color:#172033; background:#f4f6f8; }
            #${MANAGER_ID}-lightbox .codex-lightbox-nav { position:absolute; top:50%; z-index:1; width:42px; height:64px; padding:0; color:#fff; background:rgba(20,30,50,.58); border:1px solid rgba(255,255,255,.28); border-radius:8px; font-size:42px; font-weight:300; line-height:52px; cursor:pointer; transform:translateY(-50%); }
            #${MANAGER_ID}-lightbox .codex-lightbox-nav:hover { background:rgba(20,30,50,.82); }
            #${MANAGER_ID}-lightbox .codex-lightbox-prev { left:24px; }
            #${MANAGER_ID}-lightbox .codex-lightbox-next { right:24px; }
            #${CAPTURE_STATUS_ID} { position:absolute!important; top:16px; right:16px; z-index:2147483000; max-width:min(260px,calc(100% - 32px)); margin:0; }
        `;
        if (!style.isConnected) document.head.appendChild(style);
    }

    function nativeSidebarReady(sidebar) {
        const author = sidebar.querySelector('.up-info-container');
        if (!author) return true;
        const avatar = author.querySelector('.up-avatar img, img');
        const nativeAction = [...author.querySelectorAll('button, a')].some((element) => /关注|发消息|充电/.test(element.textContent || ''));
        return Boolean(avatar?.getAttribute('src') && nativeAction);
    }

    function mountPanel(panel) {
        if (!panel) return;
        const sidebar = document.querySelector('.right-container-inner.scroll-sticky') || document.querySelector('.right-container-inner');
        if (sidebar) {
            if (!nativeSidebarReady(sidebar)) {
                if (panel.parentElement === sidebar) document.body.appendChild(panel);
                panel.hidden = true;
                return;
            }
            const playlist = sidebar.querySelector('.video-pod__list.section');
            let anchor = playlist;
            while (anchor && anchor.parentElement !== sidebar) anchor = anchor.parentElement;

            // The collection list can be nested in its module. Insert before that
            // module so the panel sits between the danmaku area and the collection.
            if (anchor) {
                if (panel.parentElement !== sidebar || panel.nextElementSibling !== anchor) sidebar.insertBefore(panel, anchor);
            } else {
                // Wait for Bilibili's native sidebar modules instead of inserting
                // into the loading skeleton and disturbing its layout.
                const danmaku = sidebar.querySelector('.video-pod-above-modules');
                const danmakuAnchor = danmaku && danmaku.parentElement === sidebar ? danmaku : null;
                if (danmakuAnchor) sidebar.insertBefore(panel, danmakuAnchor);
                else {
                    panel.hidden = true;
                    return;
                }
            }
            panel.hidden = false;
        } else {
            panel.hidden = true;
        }
    }

    function bindPanelEvents(panel) {
        if (panel.dataset.codexEventsBound === '1') return;
        panel.dataset.codexEventsBound = '1';
        panel.addEventListener('click', (event) => {
            const target = event.target instanceof Element ? event.target.closest('[data-action]') : null;
            if (!target || !panel.contains(target)) return;
            event.preventDefault();
            event.stopPropagation();
            if (target.dataset.action === 'import') openFilePicker();
            if (target.dataset.action === 'clear') clearImportedTimeline();
            if (target.dataset.action === 'jump') jumpTo(Number(target.dataset.index));
            if (target.dataset.action === 'select-root') selectRootDirectory();
            if (target.dataset.action === 'manage') openManager();
            if (target.dataset.action === 'settings') {
                shortcutSettingsOpen = !shortcutSettingsOpen;
                render();
            }
            if (target.dataset.action === 'shortcut-save') saveShortcutFromPanel(panel);
            if (target.dataset.action === 'shortcut-cancel') {
                shortcutSettingsOpen = false;
                render();
            }
            if (target.dataset.action === 'toggle') {
                timelineCollapsed = !timelineCollapsed;
                render();
            }
        }, true);
    }

    function ensurePanel() {
        let panel = document.getElementById(PANEL_ID);
        if (panel) {
            bindPanelEvents(panel);
            mountPanel(panel);
            return panel;
        }
        installStyle();
        panel = document.createElement('section');
        panel.id = PANEL_ID;
        bindPanelEvents(panel);
        document.body.appendChild(panel);
        mountPanel(panel);
        return panel;
    }

    function render() {
        const panel = ensurePanel();
        const pageKey = getPageKey();
        const storage = getStorage();
        const pageData = storage.pages[pageKey] || null;
        state.pageKey = pageKey;
        state.pageData = pageData;
        panel.replaceChildren();
        panel.classList.toggle('codex-timeline-collapsed', timelineCollapsed);
        const header = document.createElement('div');
        header.className = 'codex-timeline-header';
        const title = document.createElement('span');
        title.className = 'codex-timeline-title';
        title.textContent = '时间轴';
        const actions = document.createElement('div');
        actions.className = 'codex-timeline-actions';
        actions.append(makeButton('目录', 'select-root', 'codex-timeline-action secondary'), makeButton('截图管理', 'manage', 'codex-timeline-action secondary'), makeButton('导入', 'import', 'codex-timeline-action'));
        if (pageData) actions.append(makeButton('删轴', 'clear', 'codex-timeline-action secondary'));
        actions.append(makeButton(timelineCollapsed ? '展开' : '收起', 'toggle', 'codex-timeline-action secondary'));
        actions.append(makeButton('设置', 'settings', 'codex-timeline-action secondary'));
        header.append(title, actions);
        panel.appendChild(header);
        if (shortcutSettingsOpen && !timelineCollapsed) {
            const settings = document.createElement('div');
            settings.className = 'codex-shortcut-settings';
            const current = getShortcut();
            const label = document.createElement('span');
            label.className = 'codex-shortcut-label';
            label.textContent = '截图快捷键';
            settings.appendChild(label);
            for (const modifier of ['ctrl', 'alt', 'shift']) {
                const option = document.createElement('label');
                option.className = 'codex-shortcut-option';
                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.checked = current[modifier];
                checkbox.dataset.shortcutModifier = modifier;
                option.append(checkbox, document.createTextNode(modifier[0].toUpperCase() + modifier.slice(1)));
                settings.appendChild(option);
            }
            const plus = document.createElement('span');
            plus.className = 'codex-shortcut-plus';
            plus.textContent = '+';
            settings.appendChild(plus);
            const keyInput = document.createElement('input');
            keyInput.type = 'text';
            keyInput.maxLength = 1;
            keyInput.value = current.key.toUpperCase();
            keyInput.dataset.shortcutKey = 'true';
            keyInput.title = '填写一个英文字母或数字';
            settings.appendChild(keyInput);
            settings.append(makeButton('保存', 'shortcut-save', 'codex-shortcut-save'), makeButton('取消', 'shortcut-cancel', 'codex-shortcut-cancel'));
            panel.appendChild(settings);
        }
        if (!pageData) {
            const hint = document.createElement('div');
            hint.className = 'codex-timeline-hint';
            hint.textContent = '导入 SRT、ASS 或 JSON 时间轴后，会按当前视频和分 P 自动保存。';
            panel.appendChild(hint);
            return;
        }
        const meta = document.createElement('div');
        meta.className = 'codex-timeline-meta';
        meta.textContent = `${pageData.filename} · ${pageData.items.length} 条 · 已本地保存`;
        panel.appendChild(meta);
        const list = document.createElement('div');
        list.className = 'codex-timeline-list';
        pageData.items.forEach((item, index) => {
            const row = makeButton('', 'jump', 'codex-timeline-item');
            row.dataset.index = String(index);
            const time = document.createElement('span');
            time.className = 'codex-timeline-time';
            time.textContent = formatTime(item.from);
            const content = document.createElement('span');
            content.textContent = item.content;
            row.append(time, content);
            list.appendChild(row);
        });
        panel.appendChild(list);
    }

    function clearImportedTimeline() {
        if (!window.confirm('删除当前视频已导入的本地时间轴？')) return;
        const storage = getStorage();
        delete storage.pages[getPageKey()];
        setStorage(storage);
        render();
    }

    function openFilePicker() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.srt,.ass,.json,text/plain,application/json';
        input.addEventListener('change', async () => {
            const file = input.files && input.files[0];
            if (!file) return;
            try {
                const items = await parseFile(file);
                if (!items.length) throw new Error('没有解析出有效的时间轴条目。');
                const storage = getStorage();
                storage.pages[getPageKey()] = { filename: file.name, items, savedAt: Date.now() };
                if (setStorage(storage)) render();
            } catch (error) {
                console.error('[本地时间轴] 导入失败', error);
                window.alert(`时间轴导入失败：${error.message || error}`);
            } finally { input.remove(); }
        }, { once: true });
        document.body.appendChild(input);
        input.click();
    }

    function jumpTo(index) {
        const data = state.pageData || getStorage().pages[getPageKey()];
        const item = data && data.items[index];
        const video = getVideo();
        if (!item || !video) {
            window.alert('暂时找不到视频播放器，请等视频加载后再点击。');
            return;
        }
        video.currentTime = item.from;
        video.focus({ preventScroll: true });
    }

    function getCurrentTimelineItem(currentTime) {
        const data = state.pageData || getStorage().pages[getPageKey()];
        if (!data || !Array.isArray(data.items)) return null;
        return data.items.find((item) => currentTime >= item.from && currentTime <= item.to) || null;
    }

    function captureCurrentVideo() {
        const video = getVideo();
        if (!video || !video.videoWidth || !video.videoHeight) {
            window.alert('视频画面还没有准备好，请稍后再试。');
            return;
        }
        const currentTime = video.currentTime;
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        if (!context) {
            window.alert('当前浏览器不支持截图。');
            return;
        }
        const width = video.videoWidth;
        const height = video.videoHeight;
        const overlayHeight = Math.max(48, Math.floor(width / 16));
        canvas.width = width;
        canvas.height = height + overlayHeight;
        try {
            context.drawImage(video, 0, 0, width, height);
            context.fillStyle = 'rgba(0,0,0,.78)';
            context.fillRect(0, height, width, overlayHeight);
            context.fillStyle = '#fff';
            context.font = `${Math.max(16, Math.floor(width / 85))}px sans-serif`;
            context.textBaseline = 'middle';
            context.fillText(`视频位置：${formatDetailedTime(currentTime)}`, 16, height + overlayHeight / 2);
        } catch (error) {
            console.error('[本地时间轴] 截图失败', error);
            window.alert('截图失败：视频资源被浏览器的跨域保护阻止。可以尝试刷新页面后再截取。');
            return;
        }
        saveCapturedScreenshot(canvas, currentTime).catch((error) => {
            console.error('[本地时间轴] 保存截图失败', error);
            window.alert(`保存截图失败：${error.message || error}`);
        });
    }

    async function saveCapturedScreenshot(canvas, currentTime) {
        const { directory } = await getCurrentVideoDirectory(true);
        const blob = await canvasToBlob(canvas);
        const part = getPartNumber();
        const fileName = await getUniqueScreenshotName(directory, currentTime, part);
        const imageHandle = await directory.getFileHandle(fileName, { create: true });
        const writable = await imageHandle.createWritable();
        await writable.write(blob);
        await writable.close();
        const timeline = await readScreenshotTimeline(directory);
        const entry = parseScreenshotFileName(fileName);
        const entries = sortScreenshotEntries([...timeline.entries, entry]);
        await writeScreenshotTimeline(directory, timeline.markdown, getVideoTitle(), entries);
        showCaptureSuccessFeedback(currentTime);
        if (managerState) await refreshManager();
    }

    function showCaptureSuccessFeedback(currentTime) {
        const button = document.getElementById(CAMERA_BUTTON_ID);
        const controls = button?.parentElement;
        if (!button || !controls) return;
        const fullscreenRoot = document.fullscreenElement;
        const player = fullscreenRoot?.contains(button)
            ? fullscreenRoot
            : button.closest('.bpx-player-container, .bpx-player-video-wrap') || controls;
        let status = player.querySelector(`#${CAPTURE_STATUS_ID}`);
        if (!status) {
            status = document.createElement('span');
            status.id = CAPTURE_STATUS_ID;
            player.appendChild(status);
        }
        if (status.dataset.timer) window.clearTimeout(Number(status.dataset.timer));
        status.textContent = `✓ 已保存截图 · ${formatDetailedTime(currentTime)}`;
        status.classList.add('codex-capture-status-visible');
        button.classList.add('codex-capture-success');
        button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9.2 16.6-4-4 1.4-1.4 2.6 2.6 8.2-8.2 1.4 1.4-9.6 9.6Z"/></svg>';
        button.title = `截图已保存 · ${formatDetailedTime(currentTime)}`;
        button.setAttribute('aria-label', button.title);
        const timer = window.setTimeout(() => {
            status.classList.remove('codex-capture-status-visible');
            button.classList.remove('codex-capture-success');
            button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4.5 10.2 3h3.6L15 4.5h3A3 3 0 0 1 21 7.5v9a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3v-9a3 3 0 0 1 3-3h3Zm3 3.25a5.25 5.25 0 1 0 0 10.5 5.25 5.25 0 0 0 0-10.5Zm0 1.75a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7Zm5.25-.75a1 1 0 1 0 0 2 1 1 0 0 0-2 0Z"/></svg>';
            button.title = '截取当前画面并记录时间';
            button.setAttribute('aria-label', '截取当前画面并记录时间');
            status.remove();
        }, 900);
        status.dataset.timer = String(timer);
    }

    function showToast(message, options = {}) {
        document.getElementById(TOAST_ID)?.remove();
        const toast = document.createElement('div');
        toast.id = TOAST_ID;
        toast.textContent = message;
        toast.setAttribute('role', 'status');
        toast.style.cssText = 'position:fixed;z-index:2147483648;max-width:min(320px,calc(100vw - 32px));padding:7px 11px;color:#fff;background:rgba(20,30,50,.82);border:1px solid rgba(255,255,255,.18);border-radius:6px;box-shadow:0 3px 12px rgba(0,0,0,.16);font:13px/1.35 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;pointer-events:none;opacity:0;transition:opacity .16s ease;';
        const rect = options.anchor?.getBoundingClientRect?.();
        if (rect && rect.width > 0 && rect.bottom > 0 && rect.top < window.innerHeight) {
            toast.style.left = `${Math.max(16, Math.min(window.innerWidth - 336, rect.right - 320))}px`;
            toast.style.top = `${Math.max(16, rect.top + 16)}px`;
        } else {
            toast.style.left = '50%';
            toast.style.bottom = '90px';
            toast.style.transform = 'translateX(-50%)';
        }
        if (options.tone === 'success') toast.style.borderColor = 'rgba(123,224,178,.42)';
        document.body.appendChild(toast);
        requestAnimationFrame(() => { toast.style.opacity = '1'; });
        window.setTimeout(() => {
            toast.style.opacity = '0';
            window.setTimeout(() => toast.remove(), 180);
        }, 1900);
    }

    function installProgressJump() {
        const progress = document.querySelector('.bpx-player-progress-wrap, .bpx-player-progress, .bpx-player-ctrl-progress');
        if (!progress || progress.dataset.codexTimelineProgressBound === '1') return;
        progress.dataset.codexTimelineProgressBound = '1';
        progress.addEventListener('click', (event) => {
            const video = getVideo();
            if (!video || !Number.isFinite(video.duration) || video.duration <= 0) return;
            const rect = progress.getBoundingClientRect();
            if (!rect.width) return;
            const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
            video.currentTime = ratio * video.duration;
        }, true);
    }

    function installCameraButton() {
        if (document.getElementById(CAMERA_BUTTON_ID)) return;
        const controls = document.querySelector('.bpx-player-control-bottom-right');
        if (!controls) return;
        const button = document.createElement('button');
        button.id = CAMERA_BUTTON_ID;
        button.type = 'button';
        button.title = '截取当前画面并记录时间';
        button.setAttribute('aria-label', '截取当前画面并记录时间');
        button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4.5 10.2 3h3.6L15 4.5h3A3 3 0 0 1 21 7.5v9a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3v-9a3 3 0 0 1 3-3h3Zm3 3.25a5.25 5.25 0 1 0 0 10.5 5.25 5.25 0 0 0 0-10.5Zm0 1.75a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7Zm5.25-.75a1 1 0 1 0 0 2 1 1 0 0 0-2Z"/></svg>';
        button.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            captureCurrentVideo();
        });
        controls.insertBefore(button, controls.firstChild);
    }

    async function openManager() {
        try {
            const { directory } = await getCurrentVideoDirectory(true);
            const timeline = await readScreenshotTimeline(directory);
            managerState = { directory, markdown: timeline.markdown, entries: timeline.entries, sortOrder: getScreenshotSortOrder(), objectUrls: new Map(), overlay: null };
            const overlay = document.createElement('section');
            overlay.id = MANAGER_ID;
            managerState.overlay = overlay;
            overlay.addEventListener('click', handleManagerClick);
            document.body.appendChild(overlay);
            await renderManager();
        } catch (error) {
            if (error.name !== 'AbortError') window.alert(`无法打开截图管理器：${error.message || error}`);
        }
    }

    function revokeManagerUrls() {
        if (!managerState) return;
        for (const url of managerState.objectUrls.values()) URL.revokeObjectURL(url);
        managerState.objectUrls.clear();
    }

    function closeManager() {
        closeLightbox();
        revokeManagerUrls();
        managerState?.overlay?.remove();
        managerState = null;
    }

    async function renderManager() {
        if (!managerState || !managerState.overlay) return;
        const overlay = managerState.overlay;
        revokeManagerUrls();
        overlay.replaceChildren();
        const header = document.createElement('div');
        header.className = 'codex-manager-header';
        const title = document.createElement('div');
        title.className = 'codex-manager-title';
        title.textContent = `${getVideoFolderName()} · 截图管理`;
        const close = makeButton('×', 'manager-close', 'codex-manager-close');
        close.title = '关闭';
        close.setAttribute('aria-label', '关闭截图管理');
        header.append(title, close);
        overlay.appendChild(header);
        const toolbar = document.createElement('div');
        toolbar.className = 'codex-manager-toolbar';
        toolbar.append(makeButton('刷新', 'manager-refresh', 'secondary'), makeButton('清理失效记录', 'manager-clean-missing', 'secondary'), makeButton('批量删除选中项', 'manager-delete-selected', 'danger'));
        const sortLabel = document.createElement('div');
        sortLabel.className = 'codex-manager-sort-label';
        const sortButton = makeButton(managerState.sortOrder === 'desc' ? '倒序' : '正序', 'manager-sort', 'secondary codex-manager-sort');
        sortButton.title = managerState.sortOrder === 'desc' ? '当前为倒序，点击切换为正序' : '当前为正序，点击切换为倒序';
        sortButton.setAttribute('aria-label', sortButton.title);
        sortLabel.appendChild(sortButton);
        toolbar.appendChild(sortLabel);
        overlay.appendChild(toolbar);
        const grid = document.createElement('div');
        grid.className = 'codex-manager-grid';
        if (!managerState.entries.length) {
            const empty = document.createElement('div');
            empty.className = 'codex-manager-empty';
            empty.textContent = '当前视频还没有截图。点击播放栏里的相机按钮即可创建。';
            grid.appendChild(empty);
        } else {
            for (const entry of sortManagerEntries(managerState.entries, managerState.sortOrder)) grid.appendChild(await createManagerCard(entry));
        }
        overlay.appendChild(grid);
    }

    async function createManagerCard(entry) {
        const card = document.createElement('article');
        card.className = 'codex-manager-card';
        card.dataset.fileName = entry.fileName;
        const check = document.createElement('input');
        check.type = 'checkbox';
        check.className = 'codex-manager-check';
        check.dataset.fileName = entry.fileName;
        check.title = '选择此截图';
        card.appendChild(check);
        const deleteButton = makeButton('×', 'manager-delete-one', 'codex-manager-delete-one');
        deleteButton.dataset.fileName = entry.fileName;
        deleteButton.title = '删除这张截图';
        deleteButton.setAttribute('aria-label', '删除这张截图');
        card.appendChild(deleteButton);
        const preview = document.createElement('button');
        preview.type = 'button';
        preview.className = 'codex-manager-preview';
        preview.dataset.action = 'manager-view';
        preview.dataset.fileName = entry.fileName;
        try {
            const handle = await managerState.directory.getFileHandle(entry.fileName);
            const url = URL.createObjectURL(await handle.getFile());
            managerState.objectUrls.set(entry.fileName, url);
            const image = document.createElement('img');
            image.src = url;
            image.alt = `${formatDetailedTime(entry.seconds)} 截图`;
            image.loading = 'lazy';
            preview.appendChild(image);
            entry.exists = true;
        } catch (error) {
            entry.exists = false;
            const missing = document.createElement('span');
            missing.className = 'codex-manager-missing';
            missing.textContent = '图片文件不存在';
            preview.appendChild(missing);
        }
        card.appendChild(preview);
        const info = document.createElement('div');
        info.className = 'codex-manager-info';
        const time = document.createElement('span');
        time.className = 'codex-manager-time';
        time.textContent = `P${entry.part} ${formatDetailedTime(entry.seconds)}`;
        const file = document.createElement('span');
        file.className = 'codex-manager-file';
        file.textContent = entry.fileName;
        info.append(time, file);
        card.appendChild(info);
        return card;
    }

    function captureManagerScroll() {
        const grid = managerState?.overlay?.querySelector('.codex-manager-grid');
        if (!grid) return null;
        const cards = [...grid.querySelectorAll('.codex-manager-card')];
        const scrollTop = grid.scrollTop;
        const anchor = cards.find((card) => card.offsetTop + card.offsetHeight > scrollTop + 1) || cards[cards.length - 1];
        return {
            scrollTop,
            fileName: anchor?.dataset.fileName || '',
            offset: anchor ? scrollTop - anchor.offsetTop : 0,
        };
    }

    function restoreManagerScroll(scrollState) {
        const grid = managerState?.overlay?.querySelector('.codex-manager-grid');
        if (!grid || !scrollState) return;
        const anchor = scrollState.fileName ? grid.querySelector(`[data-file-name="${CSS.escape(scrollState.fileName)}"]`) : null;
        const nextTop = anchor ? anchor.offsetTop + scrollState.offset : scrollState.scrollTop;
        grid.scrollTop = Math.max(0, Math.min(nextTop, grid.scrollHeight - grid.clientHeight));
    }

    function captureManagerScrollRatio() {
        const grid = managerState?.overlay?.querySelector('.codex-manager-grid');
        if (!grid) return 0;
        const maxScroll = Math.max(0, grid.scrollHeight - grid.clientHeight);
        return maxScroll ? grid.scrollTop / maxScroll : 0;
    }

    function restoreManagerScrollRatio(ratio) {
        const grid = managerState?.overlay?.querySelector('.codex-manager-grid');
        if (!grid) return;
        const maxScroll = Math.max(0, grid.scrollHeight - grid.clientHeight);
        grid.scrollTop = Math.max(0, Math.min(maxScroll, maxScroll * ratio));
    }

    async function refreshManager(scrollState = captureManagerScroll()) {
        if (!managerState) return;
        const timeline = await readScreenshotTimeline(managerState.directory);
        managerState.markdown = timeline.markdown;
        managerState.entries = timeline.entries;
        await renderManager();
        restoreManagerScroll(scrollState);
        window.requestAnimationFrame(() => restoreManagerScroll(scrollState));
    }

    function selectedManagerEntries() {
        if (!managerState?.overlay) return [];
        return Array.from(managerState.overlay.querySelectorAll('.codex-manager-check:checked')).map((checkbox) => managerState.entries.find((entry) => entry.fileName === checkbox.dataset.fileName)).filter(Boolean);
    }

    async function handleManagerClick(event) {
        const target = event.target instanceof Element ? event.target.closest('[data-action]') : null;
        if (!target) return;
        const action = target.dataset.action;
        if (action === 'manager-close') closeManager();
        if (action === 'manager-refresh') await refreshManager();
        if (action === 'manager-clean-missing') await deleteScreenshotEntries(managerState.entries.filter((entry) => entry.exists === false), '清理失效记录');
        if (action === 'manager-delete-selected') await deleteScreenshotEntries(selectedManagerEntries(), '删除选中截图');
        if (action === 'manager-delete-one') {
            const entry = managerState.entries.find((item) => item.fileName === target.dataset.fileName);
            if (entry) await deleteScreenshotEntries([entry], '删除截图');
        }
        if (action === 'manager-sort') await toggleManagerSort();
        if (action === 'manager-view') openLightbox(target.dataset.fileName);
    }

    async function toggleManagerSort() {
        if (!managerState) return;
        const scrollRatio = captureManagerScrollRatio();
        const order = managerState.sortOrder === 'desc' ? 'asc' : 'desc';
        managerState.sortOrder = order;
        const storage = getStorage();
        storage.screenshotSortOrder = order;
        setStorage(storage);
        await renderManager();
        restoreManagerScrollRatio(scrollRatio);
        window.requestAnimationFrame(() => restoreManagerScrollRatio(scrollRatio));
    }

    async function getDeletedFileName(deletedDirectory, originalName) {
        let suffix = 0;
        while (true) {
            const name = `${Date.now()}-${originalName}${suffix ? `-${suffix}` : ''}`;
            if (!(await fileExists(deletedDirectory, name))) return name;
            suffix += 1;
        }
    }

    async function moveToDeletedDirectory(entry) {
        if (entry.exists === false) return;
        const deletedDirectory = await managerState.directory.getDirectoryHandle('_deleted', { create: true });
        const sourceFile = await (await managerState.directory.getFileHandle(entry.fileName)).getFile();
        const destination = await deletedDirectory.getFileHandle(await getDeletedFileName(deletedDirectory, entry.fileName), { create: true });
        const writable = await destination.createWritable();
        await writable.write(sourceFile);
        await writable.close();
    }

    async function deleteScreenshotEntries(entries, actionName) {
        if (!managerState || !entries.length) {
            if (actionName === '清理失效记录') showToast('没有失效记录');
            return;
        }
        const scrollState = captureManagerScroll();
        const uniqueEntries = [...new Map(entries.map((entry) => [entry.fileName, entry])).values()];
        if (!window.confirm(`${actionName} ${uniqueEntries.length} 项？图片会移动到当前视频文件夹的 _deleted 子文件夹。`)) return;
        try {
            for (const entry of uniqueEntries) await moveToDeletedDirectory(entry);
            const removed = new Set(uniqueEntries.map((entry) => entry.fileName));
            const remaining = managerState.entries.filter((entry) => !removed.has(entry.fileName));
            await writeScreenshotTimeline(managerState.directory, managerState.markdown, getVideoTitle(), remaining);
            for (const entry of uniqueEntries) {
                if (entry.exists === false) continue;
                try { await managerState.directory.removeEntry(entry.fileName); } catch (error) { console.warn('[本地时间轴] 原图删除失败，备份仍保留在 _deleted', error); }
            }
            await refreshManager(scrollState);
            showToast(`已处理 ${uniqueEntries.length} 项`);
        } catch (error) {
            console.error('[本地时间轴] 删除截图失败', error);
            window.alert(`删除截图失败：${error.message || error}`);
        }
    }

    function openLightbox(fileName) {
        const entry = managerState?.entries.find((item) => item.fileName === fileName);
        const url = managerState?.objectUrls.get(fileName);
        if (!entry || !url) {
            window.alert('这张图片不存在，无法预览。');
            return;
        }
        closeLightbox();
        const modal = document.createElement('div');
        modal.id = `${MANAGER_ID}-lightbox`;
        const image = document.createElement('img');
        image.src = url;
        image.alt = fileName;
        modal.appendChild(image);
        const toolbar = document.createElement('div');
        toolbar.className = 'codex-lightbox-toolbar';
        const index = managerState.entries.findIndex((item) => item.fileName === fileName);
        const label = document.createElement('span');
        label.className = 'codex-lightbox-label';
        label.textContent = `P${entry.part} ${formatDetailedTime(entry.seconds)} · ${fileName}`;
        const previous = makeButton('上一张', 'lightbox-prev', '');
        const jump = makeButton('跳转视频', 'lightbox-jump', '');
        const remove = makeButton('删除', 'lightbox-delete', 'danger');
        const next = makeButton('下一张', 'lightbox-next', '');
        const close = makeButton('关闭', 'lightbox-close', '');
        const previousSide = makeButton('‹', 'lightbox-prev', 'codex-lightbox-nav codex-lightbox-prev');
        const nextSide = makeButton('›', 'lightbox-next', 'codex-lightbox-nav codex-lightbox-next');
        previous.disabled = index <= 0;
        next.disabled = index >= managerState.entries.length - 1;
        previousSide.disabled = previous.disabled;
        nextSide.disabled = next.disabled;
        toolbar.append(previous, jump, remove, next, close, label);
        modal.append(previousSide, nextSide);
        modal.appendChild(toolbar);
        modal.addEventListener('click', async (event) => {
            if (event.target === modal) {
                closeLightbox();
                return;
            }
            if (event.target === image) {
                const imageRect = image.getBoundingClientRect();
                const position = imageRect.width ? (event.clientX - imageRect.left) / imageRect.width : 0.5;
                const currentIndex = managerState.entries.findIndex((item) => item.fileName === fileName);
                if (position < 0.28 && currentIndex > 0) openLightbox(managerState.entries[currentIndex - 1].fileName);
                if (position > 0.72 && currentIndex < managerState.entries.length - 1) openLightbox(managerState.entries[currentIndex + 1].fileName);
                return;
            }
            const target = event.target instanceof Element ? event.target.closest('[data-action]') : null;
            if (!target) return;
            const currentIndex = managerState.entries.findIndex((item) => item.fileName === fileName);
            if (target.dataset.action === 'lightbox-close') closeLightbox();
            if (target.dataset.action === 'lightbox-prev' && currentIndex > 0) openLightbox(managerState.entries[currentIndex - 1].fileName);
            if (target.dataset.action === 'lightbox-next' && currentIndex < managerState.entries.length - 1) openLightbox(managerState.entries[currentIndex + 1].fileName);
            if (target.dataset.action === 'lightbox-jump') {
                const video = getVideo();
                if (video) video.currentTime = entry.seconds;
                closeManager();
            }
            if (target.dataset.action === 'lightbox-delete') {
                closeLightbox();
                await deleteScreenshotEntries([entry], '删除截图');
            }
        });
        document.body.appendChild(modal);
        const keydown = (event) => {
            if (!lightboxState) return;
            if (event.key === 'Escape') closeLightbox();
            if (event.key === 'ArrowLeft' && index > 0) openLightbox(managerState.entries[index - 1].fileName);
            if (event.key === 'ArrowRight' && index < managerState.entries.length - 1) openLightbox(managerState.entries[index + 1].fileName);
        };
        window.addEventListener('keydown', keydown);
        lightboxState = { modal, keydown };
    }

    function closeLightbox() {
        if (!lightboxState) return;
        window.removeEventListener('keydown', lightboxState.keydown);
        lightboxState.modal.remove();
        lightboxState = null;
    }

    function selectRootDirectory() {
        chooseRootDirectory().then((handle) => showToast(`保存目录：${handle.name}`)).catch((error) => {
            if (error.name !== 'AbortError') window.alert(`设置保存目录失败：${error.message || error}`);
        });
    }

    function isEditableTarget(target) {
        return target instanceof Element && Boolean(target.closest('input, textarea, select, [contenteditable="true"]'));
    }

    function installShortcutListener() {
        document.addEventListener('keydown', (event) => {
            if (event.repeat || isEditableTarget(event.target)) return;
            const shortcut = getShortcut();
            if (event.key.toLowerCase() !== shortcut.key
                || event.ctrlKey !== shortcut.ctrl
                || event.altKey !== shortcut.alt
                || event.shiftKey !== shortcut.shift
                || event.metaKey) return;
            event.preventDefault();
            event.stopPropagation();
            captureCurrentVideo();
        }, true);
    }

    function installRouteWatcher() {
        let lastUrl = window.location.href;
        const check = () => {
            if (window.location.href !== lastUrl) {
                lastUrl = window.location.href;
                render();
                if (managerState) closeManager();
            }
            const panel = ensurePanel();
            mountPanel(panel);
            installCameraButton();
            installProgressJump();
        };
        for (const method of ['pushState', 'replaceState']) {
            const original = window.history[method];
            window.history[method] = function (...args) {
                const result = original.apply(this, args);
                window.setTimeout(check, 100);
                return result;
            };
        }
        window.addEventListener('popstate', () => window.setTimeout(check, 100));
        window.addEventListener('hashchange', () => window.setTimeout(check, 100));
        window.setInterval(check, 800);
    }

    loadRootDirectory().then((handle) => { rootDirectoryHandle = handle; });
    ensurePanel();
    render();
    installCameraButton();
    installProgressJump();
    installShortcutListener();
    installRouteWatcher();
})();
