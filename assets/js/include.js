// /assets/js/include.js
export async function injectIncludes() {
    const nodes = document.querySelectorAll('[data-include]');

    await Promise.all([...nodes].map(async (el) => {
        const raw = (el.getAttribute('data-include') || '').trim();

        // ---- 安全チェック ----
        // 1) 空/不正
        if (!raw) return renderError(el);
        // 2) 絶対URL/ルート絶対は不可（http(s)://, //, /）
        if (/^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(raw) || raw.startsWith('/')) {
            return renderError(el);
        }
        // 3) ディレクトリトラバーサル防止
        if (raw.includes('..')) return renderError(el);

        // 相対URLを解決
        let url;
        try {
            url = new URL(raw, location.href);
        } catch {
            return renderError(el);
        }

        // 4) 同一オリジンのみ
        if (url.origin !== location.origin) return renderError(el);

        // 5) /partials/ セグメント配下の .html のみ許可
        const path = url.pathname;
        const inPartials = path.split('/').includes('partials');
        if (!inPartials || !path.endsWith('.html')) return renderError(el);

        // 6) クエリは任意だが、長すぎたり怪しい文字は拒否（任意の堅さ）
        //    例: v=202510010001 などはOK
        if (url.search.length > 0 && !/^[?&=A-Za-z0-9_.\-&%]{1,128}$/.test(url.search)) {
            return renderError(el);
        }
        // ---- /安全チェック ----

        try {
            const res = await fetch(url.toString(), { cache: 'no-cache' });
            if (!res.ok) throw new Error('fetch failed');
            const html = await res.text();
            // 自前管理の partials のみを取り込む前提
            el.outerHTML = html;
        } catch {
            renderError(el);
        }
    }));
}

function renderError(el) {
    // URLは出さない。固定文言のみ（textContentでXSS回避）
    const box = document.createElement('div');
    box.setAttribute('role', 'alert');
    box.style.background = '#fee';
    box.style.color = '#b00';
    box.style.padding = '8px';
    box.style.border = '1px solid #f99';
    box.style.fontSize = '14px';
    box.textContent = '読み込み失敗';
    el.replaceChildren(box);
}

injectIncludes();
