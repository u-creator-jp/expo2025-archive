// /assets/x-embed.js
(() => {
    'use strict';

    /* ===== チューニング値 ===== */
    const FIRST = 3;                 // 初回描画件数
    const STEP  = 3;                 // 追加ロード件数
    const ESTIMATE = 420;            // 仮高さ（masonry初期配置用）
    const IFRAME_WAIT_MS = 1200;     // iframe挿入待ちタイムアウト
    const CREATE_TWEET_TIMEOUT = 8000; // createTweet自体のタイムアウト
    const WIDGETS_LOAD_TIMEOUT = 4000; // widgets.loadのタイムアウト
    const MAX_RETRY = 3;             // 失敗時の最大リトライ回数
    const RETRY_BASE_MS = 600;       // バックオフ初期値

    const masonry = document.getElementById('masonry');
    const btnMore = document.getElementById('btnMore');
    const moreWrap = btnMore.closest('.more');
    const backHome = document.querySelector('.back-home');

    /* ===== 共通：ユーティリティ ===== */
    const sleep = (ms)=>new Promise(r=>setTimeout(r, ms));

    // タイムアウト付き実行
    async function withTimeout(promise, ms, label='timeout'){
        let t;
        const timeout = new Promise((_, rej)=>{ t=setTimeout(()=>rej(new Error(label)), ms); });
        try{ return await Promise.race([promise, timeout]); }
        finally{ clearTimeout(t); }
    }

    // 冪等なTwitter widgets.js ローダー（1回だけ読み込む）
    let widgetsReady = false, widgetsLoading = false, widgetsQueue = [];
    function ensureTwitter(){
        return new Promise((resolve) => {
            if (widgetsReady && window.twttr?.widgets){ resolve(); return; }
            widgetsQueue.push(resolve);
            if (widgetsLoading) return;

            widgetsLoading = true;

            // 既にscriptが居る場合（他スクリプトが追加済み）
            if (document.getElementById('tw-widget-js')){
                const iv=setInterval(()=>{
                    if (window.twttr?.widgets){
                        clearInterval(iv); widgetsReady = true; widgetsLoading = false;
                        widgetsQueue.splice(0).forEach(fn=>fn());
                    }
                }, 40);
                // セーフティタイムアウト（10秒）
                setTimeout(()=>{
                    if (!widgetsReady){
                        console.warn('[widgets] load stalled; proceed without ready flag');
                        widgetsLoading = false;
                        widgetsQueue.splice(0).forEach(fn=>fn());
                    }
                }, 10000);
                return;
            }

            const s=document.createElement('script');
            s.id='tw-widget-js'; s.async=true; s.src='https://platform.twitter.com/widgets.js';
            s.onload=()=>{
                widgetsReady = true; widgetsLoading = false;
                widgetsQueue.splice(0).forEach(fn=>fn());
            };
            s.onerror=()=>{
                console.warn('[widgets] failed to load script; continue anyway');
                widgetsLoading = false;
                widgetsQueue.splice(0).forEach(fn=>fn()); // フォールバック路
            };
            document.head.appendChild(s);
        });
    }

    // 429や一時失敗に対する指数バックオフ付きリトライヘルパ
    async function retry(fn, {max=MAX_RETRY, base=RETRY_BASE_MS, label=''} = {}){
        let lastErr;
        for (let i=0;i<max;i++){
            try{
                const r = await fn(i);
                return r;
            }catch(e){
                lastErr = e;
                const delay = base * Math.pow(2, i) + Math.floor(Math.random()*100);
                console.warn(`[retry] ${label} #${i+1} failed: ${e?.message||e}, wait ${delay}ms`);
                await sleep(delay);
            }
        }
        throw lastErr;
    }

    // iframe挿入監視：存在した/しないの真偽値を返す
    function waitIframeInserted(root, timeout=IFRAME_WAIT_MS){
        return new Promise((resolve)=>{
            if (!root.isConnected) { resolve(false); return; } // ← 追加（DOMから外れていれば中止）
            if (root.querySelector('iframe')) { resolve(true); return; }
            const mo=new MutationObserver(()=>{ if(root.querySelector('iframe')){ mo.disconnect(); resolve(true); }});
            mo.observe(root,{childList:true,subtree:true});
            setTimeout(()=>{ mo.disconnect(); resolve(false); }, timeout);
        });
    }

    // URLからTweet ID抽出
    function extractTweetIdFromBlockquote(bq){
        const a=[...bq.querySelectorAll('a')].find(x=>/\/status\/\d+/.test(x.href));
        return a ? (a.href.match(/status\/(\d+)/)?.[1] || null) : null;
    }

    /* ===== Masonry ===== */
    function columnCount(){
        if (matchMedia('(max-width:640px)').matches) return 1;
        if (matchMedia('(max-width:1024px)').matches) return 2;
        return 3;
    }
    let cols=[],heights=[],cards=[];
    function buildColumns(n){ masonry.innerHTML=''; cols=[]; heights=[];
        for(let i=0;i<n;i++){ const c=document.createElement('div'); c.className='col';
            masonry.appendChild(c); cols.push(c); heights.push(0); } }
    function shortest(){ let k=0,m=heights[0]; for(let i=1;i<heights.length;i++) if(heights[i]<m){m=heights[i];k=i} return k; }
    function placeCard(card,est=ESTIMATE){ const i=shortest(); cols[i].appendChild(card); heights[i]+=est; card.dataset.colIndex=i; card.dataset.est=est; cards.push(card); }
    function finalizeCard(card){
        const i=+card.dataset.colIndex||0, est=+card.dataset.est||0;
        const real=card.getBoundingClientRect().height;
        heights[i]+= Math.max(0, real - est);
        card.style.minHeight = real + 'px'; // ★ 一度計測した実高さを下限として保持
    }
    function cancelCard(card){
        const i=+card.dataset.colIndex||0, est=+card.dataset.est||0;
        heights[i] = Math.max(0, heights[i]-est);
        const idx = cards.indexOf(card);
        if (idx>=0) cards.splice(idx,1);
        card.remove();
    }
    function relayout(){
        const n = columnCount();
        // ★ 現在の列数と同じなら、DOMを触らない（＝iframeを動かさない）
        if (cols.length === n) return;
        const saved = cards.slice();
        cards = [];
        buildColumns(n);
        for (const card of saved) {
            card.style.minHeight = ''; // 画面幅が本当に変わったときだけリセット
            placeCard(card, +card.dataset.est || ESTIMATE);
        }
    }
    buildColumns(columnCount());
    // ★ 幅がほぼ変わらないresize（アドレスバー伸縮など）は無視
    let __lastW = innerWidth;
    addEventListener('resize', (() => {
        let t;
        return () => {
            clearTimeout(t);
            t = setTimeout(() => {
                const w = innerWidth;
                if (Math.abs(w - __lastW) < 12) return; // ★ 幅変化が小さいときは何もしない
                __lastW = w;
                relayout();
            }, 120);
        };
    })());

    /* ===== blockquote を回収（順序維持） ===== */
    let queue=[];
    (function collect(){
        const list = Array.from(document.querySelectorAll('blockquote.twitter-tweet'));
        for (const bq of list){
            const cloned = bq.cloneNode(true);
            bq.remove();              // 自動変換を回避
            queue.push(cloned);
        }
    })();

    /* ===== 1件描画（スキップ完全対応版） ===== */
    async function renderOne(bq){
        // ★ 一度描画した要素は再初期化しない（全デバイス共通）
        if (bq.dataset.hydrated === '1') {
            return;
        }

        const id = extractTweetIdFromBlockquote(bq);
        if (!id){
            console.warn('[skip] tweet id not found in blockquote');
            return;
        }

        const card=document.createElement('article'); card.className='card pending';
        const inner=document.createElement('div'); inner.className='card-inner';
        inner.innerHTML=`
            <div class="skel title"></div>
            <div class="skel l"></div>
            <div class="skel l"></div>
            <div class="skel media"></div>
            <div class="spinner" role="status" aria-label="読み込み中"></div>`;
        const mount=document.createElement('div');
        card.appendChild(inner); card.appendChild(mount);
        placeCard(card, ESTIMATE);

        await ensureTwitter();

        let created = false;
        try{
            if (window.twttr?.widgets?.createTweet){
                await retry(
                    async ()=>{
                        await withTimeout(
                            window.twttr.widgets.createTweet(id, mount, {align:'center', conversation: 'none', dnt:true}),
                            CREATE_TWEET_TIMEOUT,
                            'createTweet/timeout'
                        );
                        return true;
                    },
                    {max: MAX_RETRY, base: RETRY_BASE_MS, label:`createTweet(${id})`}
                );
                created = true;
            }
        }catch(e){
            console.warn(`[createTweet] failed: ${e?.message||e}`);
            created = false;
        }

        if (!created){
            const fb=bq.cloneNode(true); fb.style.margin='0';
            mount.appendChild(fb);
            try{
                // ★ 再初期化やチラつき抑制のため、widgets.load() は原則呼ばない（全環境）
                // await withTimeout(
                //   new Promise(res=>{ window.twttr?.widgets?.load ? (window.twttr.widgets.load(mount), res()) : res(); }),
                //   WIDGETS_LOAD_TIMEOUT,
                //   'widgets.load/timeout'
                // );
            }catch(e){
                console.warn(`[widgets.load] failed: ${e?.message||e}`);
            }
        }

        const inserted = await waitIframeInserted(card, IFRAME_WAIT_MS);
        if (!inserted){
            cancelCard(card);
            return;
        }

        inner.remove();
        card.classList.remove('pending');
        finalizeCard(card);

        // ★ 描画完了フラグ：以後この要素は再初期化しない
        bq.dataset.hydrated = '1';
    }

    /* ===== バッチ描画 ===== */
    let cursor = 0;
    let isRendering = false;

    // ★ スクロール方向検知（上スクロール時は新規初期化を抑止）
    let lastScrollY = window.scrollY;
    let scrollDir = 'down';
    addEventListener('scroll', (() => {
        let t;
        return () => {
            cancelAnimationFrame(t);
            t = requestAnimationFrame(() => {
                const y = window.scrollY;
                scrollDir = (y < lastScrollY) ? 'up' : 'down';
                lastScrollY = y;
            });
        };
    })(), { passive: true });

    async function renderBatch(n){
        if (isRendering) return;
        if (cursor >= queue.length) { updateMore(); return; }

        // ★ 上スクロール中は新規ロードを行わず、既存表示を維持（ちらつき軽減）
        if (scrollDir === 'up') {
            return;
        }

        isRendering = true;
        btnMore.disabled = true;

        const start = cursor;
        const end   = Math.min(cursor + n, queue.length);
        cursor = end;

        const tasks=[];
        for (let i=start; i<end; i++) tasks.push(renderOne(queue[i]));
        await Promise.allSettled(tasks);

        isRendering = false;
        updateMore();
        maybeAutoLoad();
    }

    function updateMore(){
        const remain = queue.length - cursor;
        if (remain <= 0){
            btnMore.textContent = 'すべて表示しました';
            btnMore.disabled = true;
            if (io) { try { io.unobserve(btnMore); } catch(_){} }
            if (moreWrap) moreWrap.style.display = 'none';
            if (backHome) backHome.style.display = '';
        }else{
            if (moreWrap) moreWrap.style.display = '';
            btnMore.disabled = false;
            btnMore.textContent = `もっと表示（+${Math.min(STEP, remain)}）`;
            if (backHome) backHome.style.display = 'none';
        }
    }

    /* ===== 自動追加 ===== */
    function isInViewport(el, extra=220){
        const r = el.getBoundingClientRect();
        return r.top <= (innerHeight + extra);
    }
    function maybeAutoLoad(){
        if (moreWrap && moreWrap.style.display === 'none') return;
        if (!btnMore.disabled && !isRendering && isInViewport(btnMore, 220)){
            btnMore.click();
        }
    }
    let io=null;
    function attachObserver(){
        if (io) return;
        io = new IntersectionObserver(es => {
            es.forEach(e => { if (e.isIntersecting) maybeAutoLoad(); });
        }, {root:null, rootMargin:'220px', threshold:0});
        io.observe(btnMore);
        setTimeout(maybeAutoLoad, 0);
    }
    addEventListener('scroll', ()=>maybeAutoLoad(), {passive:true});

    /* ===== 初期起動 ===== */
    (async () => {
        if (backHome) backHome.style.display = 'none';
        await renderBatch(Math.min(FIRST, queue.length));
        updateMore();
        attachObserver();
    })();

    btnMore.addEventListener('click', async () => {
        if (isRendering) return;
        await renderBatch(STEP);
    });

})();
