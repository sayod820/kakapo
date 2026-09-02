/** Стили шапки раздела Клиенты (статистика + фильтры) — как у поставщиков */
export const CLIENTS_MODULE_CSS = `
.k-clients-mod .k-cli-meta{display:none}
.k-clients-mod .k-cli-meta span{display:block;font-size:9px;color:var(--muted);font-weight:700}
.k-clients-mod .k-cli-meta b{display:block;font-size:11px;font-weight:900;margin-top:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.k-clients-mod .k-clients-head{margin:0 0 8px}
.k-clients-mod .k-cli-toolbar .k-clients-chips{
  display:flex;flex-wrap:wrap;gap:6px;margin:0;padding:0;border:none;background:transparent
}
.k-clients-mod .k-cli-toolbar .k-clients-chips .k-subtab{flex-shrink:0}

@media (max-width:900px){
  .k-clients-mod .k-cli-meta{
    display:grid!important;grid-template-columns:repeat(5,minmax(0,1fr));gap:4px;
    margin:0 0 8px;padding:6px 8px;border:1px solid var(--border);border-radius:10px;background:var(--card)
  }
  .k-clients-mod .k-cli-toolbar{
    flex:none;padding:8px;margin:0;border:1px solid var(--border);border-radius:12px;background:var(--card)
  }
  .k-clients-mod .k-cli-toolbar .k-clients-chips,
  .k-clients-mod .k-clients-head .k-clients-chips{
    display:grid!important;grid-template-columns:repeat(3,minmax(0,1fr));gap:4px;
    width:100%;padding:4px;margin:0;overflow:visible!important;
    background:var(--card2);border:1px solid var(--border);border-radius:10px;
    position:static!important;top:auto!important;flex-wrap:wrap!important;
    -webkit-overflow-scrolling:auto;scrollbar-width:auto
  }
  .k-clients-mod .k-cli-toolbar .k-clients-chips .k-subtab,
  .k-clients-mod .k-clients-head .k-clients-chips .k-subtab{
    display:flex!important;align-items:center;justify-content:center;width:100%;
    min-height:32px!important;padding:6px 4px!important;font-size:10px;border-radius:8px;
    border:none;flex-shrink:0;white-space:nowrap
  }
  .k-clients-mod .k-clients-head{
    position:relative;top:auto;z-index:1;background:transparent;padding:0;margin:0 0 8px
  }
  .k-clients-mod .k-clients-head .k-subtabs{
    position:static!important;top:auto!important;background:transparent!important;
    padding-top:0!important;margin-top:0!important;overflow:visible!important
  }
}

html.kakapo-android .k-clients-mod .k-cli-meta{
  display:grid!important;grid-template-columns:repeat(5,minmax(0,1fr));gap:4px;
  margin:0 0 8px;padding:6px 8px;border:1px solid var(--border);border-radius:10px;background:var(--card)
}
html.kakapo-android .k-clients-mod .k-cli-toolbar{
  flex:none;padding:8px;margin:0 0 8px;border:1px solid var(--border);border-radius:12px;background:var(--card)
}
html.kakapo-android .k-clients-mod .k-cli-toolbar .k-clients-chips,
html.kakapo-android .k-clients-mod .k-clients-head .k-clients-chips{
  display:grid!important;grid-template-columns:repeat(3,minmax(0,1fr));gap:4px;
  width:100%;padding:4px;margin:0;overflow:visible!important;
  background:var(--card2);border:1px solid var(--border);border-radius:10px;
  position:static!important;top:auto!important
}
html.kakapo-android .k-clients-mod .k-cli-toolbar .k-clients-chips .k-subtab,
html.kakapo-android .k-clients-mod .k-clients-head .k-clients-chips .k-subtab{
  display:flex!important;align-items:center;justify-content:center;width:100%;
  min-height:32px!important;padding:6px 4px!important;font-size:10px;border-radius:8px;border:none
}
html.kakapo-android .k-clients-mod .k-clients-head .k-subtabs{
  position:static!important;overflow:visible!important;margin-top:0!important;padding-top:0!important
}
`
