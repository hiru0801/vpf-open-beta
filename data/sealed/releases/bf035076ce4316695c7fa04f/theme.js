'use strict';

(() => {
  const key='vpf-app-v2/theme';
  const system=window.matchMedia('(prefers-color-scheme: dark)');
  let preference;
  try { preference=localStorage.getItem(key); } catch { /* The current tab can still change theme. */ }

  function applyTheme() {
    const dark=preference==='dark'||(preference!=='light' && system.matches);
    document.documentElement.dataset.theme=dark?'dark':'light';
    document.querySelector('[name="theme-color"]').content=dark?'#151e2e':'#172b49';
    const toggle=document.getElementById('theme-toggle');
    if (toggle) {
      toggle.setAttribute('aria-pressed',String(dark));
      toggle.title=dark?'Chuyển sang giao diện sáng':'Chuyển sang giao diện tối';
    }
  }

  applyTheme();
  document.addEventListener('DOMContentLoaded',()=>{
    applyTheme();
    document.getElementById('theme-toggle').addEventListener('click',()=>{
      preference=document.documentElement.dataset.theme==='dark'?'light':'dark';
      try { localStorage.setItem(key,preference); } catch { /* Keep this tab's selection. */ }
      applyTheme();
    });
  });
  system.addEventListener?.('change',applyTheme);
})();
