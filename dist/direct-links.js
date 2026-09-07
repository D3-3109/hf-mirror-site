// 直连检测 —— 由镜像注入到经代理的 /models 列表页。
// 能直接访问 huggingface.co 的用户，点击模型卡片直达原站详情页，
// 避免详情页流量走镜像、镜像出口 IP 被 HF 限流（429）。
// 与首页 scripts.js 共享 sessionStorage 缓存（hfDirect / hfDirectExpire）。
(function () {
    'use strict';

    // HF 顶级路由前缀：两段路径的第一段若是这些，则不是 org/repo 链接
    var RESERVED = {
        models: 1, datasets: 1, spaces: 1, docs: 1, api: 1, settings: 1,
        login: 1, join: 1, logout: 1, profile: 1, organizations: 1, orgs: 1,
        tasks: 1, static: 1, front: 1, resources: 1, blog: 1, jobs: 1,
        collections: 1, papers: 1, trending: 1, privacy: 1,
        'terms-of-service': 1, huggingface: 1, dashboard: 1, account: 1,
        webhooks: 1, newline: 1, help: 1, support: 1, pricing: 1,
        enterprise: 1, team: 1, inference: 1, contact: 1, careers: 1,
        press: 1, brand: 1, about: 1, calculate: 1, organizations: 1,
        chat: 1, assistants: 1, extensions: 1, course: 1, locales: 1
    };

    function isRepoLink(a) {
        var href = a.getAttribute('href') || '';
        if (href.indexOf('http') === 0 || href.indexOf('//') === 0) return false;
        var m = href.match(/^\/([^/]+)\/([^/?#]+)/);
        if (!m) return false;
        return !RESERVED[m[1].toLowerCase()];
    }

    function rewriteAll() {
        var links = document.querySelectorAll('a');
        for (var i = 0; i < links.length; i++) {
            var a = links[i];
            var href = a.getAttribute('href') || '';
            // 仓库链接与文档链接直达原站；列表/筛选等其余链接留在镜像
            if (isRepoLink(a) || href.indexOf('/docs/') === 0) {
                a.setAttribute('href', 'https://huggingface.co' + href);
            }
        }
    }

    var pending = null;
    function scheduleRewrite() {
        if (pending !== null) return;
        pending = setTimeout(function () {
            pending = null;
            rewriteAll();
        }, 150);
    }

    function probe() {
        var expire = sessionStorage.getItem('hfDirectExpire');
        if (expire && Date.now() < Number(expire)) {
            return Promise.resolve(sessionStorage.getItem('hfDirect') === '1');
        }
        var ctrl = new AbortController();
        var timer = setTimeout(function () { ctrl.abort(); }, 5000);
        return fetch('https://huggingface.co/favicon.ico', {
            mode: 'no-cors',
            cache: 'no-store',
            signal: ctrl.signal
        }).then(function () {
            sessionStorage.setItem('hfDirect', '1');
            return true;
        }).catch(function () {
            sessionStorage.setItem('hfDirect', '0');
            return false;
        }).finally(function () {
            clearTimeout(timer);
            sessionStorage.setItem('hfDirectExpire',
                String(Date.now() + 30 * 60 * 1000));
        });
    }

    probe().then(function (direct) {
        if (!direct) return;
        rewriteAll();
        // React 应用持续重渲染（滚动加载、筛选），监听新增节点补写链接。
        // 只观察 childList：本脚本改 href 是属性变更，不会自触发循环。
        new MutationObserver(scheduleRewrite).observe(document.body, {
            childList: true,
            subtree: true
        });
    });
})();
