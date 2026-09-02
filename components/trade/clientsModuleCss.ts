/** Стили шапки раздела Клиенты: статистика + отступ сверху; фильтры — горизонтальная полоса */
export const CLIENTS_MODULE_CSS = `
.k-clients-mod .k-cli-meta{display:none}
.k-clients-mod .k-cli-meta span{display:block;font-size:9px;color:var(--muted);font-weight:700}
.k-clients-mod .k-cli-meta b{display:block;font-size:11px;font-weight:900;margin-top:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.k-clients-mod .k-clients-head{margin:0 0 8px}

@media (max-width:900px){
  .k-clients-mod .k-cli-meta{
    display:grid!important;grid-template-columns:repeat(5,minmax(0,1fr));gap:4px;
    margin:0 0 8px;padding:6px 8px;border:1px solid var(--border);border-radius:10px;background:var(--card)
  }
  .k-clients-mod .k-cli-toolbar{
    flex:none;padding:0;margin:0 0 8px;border:none;border-radius:0;background:transparent
  }
  .k-clients-mod .k-cli-toolbar .k-clients-chips,
  .k-clients-mod .k-clients-head .k-clients-chips{
    display:flex!important;flex-wrap:nowrap!important;gap:5px;
    width:100%;padding:0;margin:0;overflow-x:auto!important;overflow-y:hidden;
    background:transparent!important;border:none!important;border-radius:0;
    position:static!important;top:auto!important;
    -webkit-overflow-scrolling:touch;scrollbar-width:none
  }
  .k-clients-mod .k-cli-toolbar .k-clients-chips::-webkit-scrollbar,
  .k-clients-mod .k-clients-head .k-clients-chips::-webkit-scrollbar{display:none}
  .k-clients-mod .k-cli-toolbar .k-clients-chips .k-subtab,
  .k-clients-mod .k-clients-head .k-clients-chips .k-subtab{
    display:inline-flex!important;width:auto!important;flex-shrink:0;
    min-height:30px!important;padding:5px 9px!important;font-size:11px;border-radius:8px;
    border:1px solid var(--border)!important;background:var(--card2)!important;
    white-space:nowrap
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
  padding:0;margin:0 0 8px;border:none;background:transparent
}
html.kakapo-android .k-clients-mod .k-cli-toolbar .k-clients-chips,
html.kakapo-android .k-clients-mod .k-clients-head .k-clients-chips{
  display:flex!important;flex-wrap:nowrap!important;gap:5px;
  width:100%;padding:0;margin:0;overflow-x:auto!important;
  background:transparent!important;border:none!important;
  position:static!important;-webkit-overflow-scrolling:touch;scrollbar-width:none
}
html.kakapo-android .k-clients-mod .k-cli-toolbar .k-clients-chips .k-subtab,
html.kakapo-android .k-clients-mod .k-clients-head .k-clients-chips .k-subtab{
  display:inline-flex!important;width:auto!important;flex-shrink:0;
  min-height:30px!important;padding:5px 9px!important;font-size:11px;border-radius:8px;
  border:1px solid var(--border)!important;background:var(--card2)!important
}
html.kakapo-android .k-clients-mod .k-clients-head .k-subtabs{
  position:static!important;overflow:visible!important;margin-top:0!important;padding-top:0!important
}
`
