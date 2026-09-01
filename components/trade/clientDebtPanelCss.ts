/** Стили панели долга клиента (как в кассе) — для Торговля / Долги */
export const CLIENT_DEBT_PANEL_CSS = `
.client-debt-panel{
  display:flex;flex-direction:column;flex:1;min-height:0;overflow:hidden;
}
.client-debt-panel .cashier-debts-head{padding:6px 8px!important;}
.client-debt-panel .cashier-debts-av{width:30px;height:30px;font-size:11px;}
.client-debt-panel .cashier-debts-hero{
  display:grid;grid-template-columns:1.35fr 1fr;gap:8px;margin:0 0 6px;flex-shrink:0;
}
.client-debt-panel .cashier-debts-hero-main{
  padding:8px 10px;border-radius:12px;background:rgba(255,90,90,.08);
  border:1px solid rgba(255,90,90,.28);
}
.client-debt-panel .cashier-debts-hero-main .kl{font-size:11px;color:var(--muted);font-weight:800;}
.client-debt-panel .cashier-debts-hero-main .kv{font-size:22px;font-weight:900;margin-top:2px;line-height:1.05;font-family:'JetBrains Mono',monospace;}
.client-debt-panel .cashier-debts-hero-cur{font-size:12px;font-weight:800;margin-left:3px;opacity:.85;}
.client-debt-panel .cashier-debts-hero-main .kh{font-size:10px;color:var(--muted);margin-top:4px;line-height:1.3;}
.client-debt-panel .cashier-debts-hero-side{
  display:flex;flex-direction:column;gap:4px;padding:7px 9px;border-radius:12px;
  background:var(--card2);border:1px solid var(--border);
}
.client-debt-panel .cashier-debts-hero-side > div{display:flex;justify-content:space-between;align-items:baseline;gap:6px;}
.client-debt-panel .cashier-debts-hero-side .kl{font-size:10px;color:var(--muted);font-weight:700;}
.client-debt-panel .cashier-debts-hero-side b{font-size:12px;font-family:'JetBrains Mono',monospace;}
.client-debt-panel .cashier-debts-split{
  display:flex;flex-wrap:wrap;gap:6px 12px;margin:0 0 6px;font-size:11px;color:var(--muted);flex-shrink:0;
}
.client-debt-panel .cashier-debts-split b{font-family:'JetBrains Mono',monospace;}
.client-debt-panel .cashier-debt-hint{font-size:10px;color:var(--muted);margin:0 0 6px;line-height:1.25;}
.client-debt-panel .cashier-debt-sec{
  font-size:9px;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;
  margin:4px 0 2px;padding:0 2px;
}
.client-debt-panel .cashier-debt-checks{display:flex;flex-direction:column;gap:2px;}
.client-debt-panel button.cashier-debt-check,.client-debt-panel .cashier-debt-check{
  display:flex;align-items:center;gap:6px;width:100%;text-align:left;margin:0;padding:3px 7px;
  min-height:0;border-radius:7px;border:1px solid var(--border);background:var(--card2);color:inherit;cursor:pointer;
}
.client-debt-panel button.cashier-debt-check:hover{border-color:var(--green);background:rgba(31,215,96,.04);}
.client-debt-panel .cashier-debt-check-id{
  display:flex;flex-direction:column;gap:0;min-width:0;flex:1 1 88px;overflow:hidden;
}
.client-debt-panel .cashier-debt-check-title{
  display:flex;align-items:baseline;gap:5px;min-width:0;flex-wrap:nowrap;overflow:hidden;
}
.client-debt-panel .cashier-debt-check-title b{
  font-size:11px;font-weight:900;white-space:nowrap;flex-shrink:0;
}
.client-debt-panel .cashier-debt-check-title em{
  font-style:normal;font-size:9px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
}
.client-debt-panel .cashier-debt-check-note{
  font-style:normal!important;font-size:9px!important;font-weight:700!important;color:var(--gold)!important;
  max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;line-height:1.2;
}
.client-debt-panel .cashier-debt-check-st{
  font-size:9px;font-weight:800;white-space:nowrap;flex-shrink:0;margin-left:2px;
}
.client-debt-panel .cashier-debt-check-nums{
  display:flex;gap:5px;flex-shrink:0;align-items:center;margin-left:auto;
}
.client-debt-panel .cashier-debt-check-nums > span{
  display:flex;flex-direction:column;align-items:flex-end;gap:0;line-height:1.05;min-width:38px;
}
.client-debt-panel .cashier-debt-check-nums i{font-style:normal;font-size:8px;color:var(--muted);font-weight:700;}
.client-debt-panel .cashier-debt-check-nums b{font-size:10px;font-family:'JetBrains Mono',monospace;font-weight:900;}
.client-debt-panel .cashier-debt-pays{display:flex;flex-direction:column;gap:3px;}
.client-debt-panel button.cashier-debt-pay,.client-debt-panel .cashier-debt-pay{
  display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;text-align:left;
  margin:0;padding:6px 8px;border-radius:8px;border:1px solid var(--border);
  background:var(--card2);color:inherit;cursor:pointer;
}
.client-debt-panel .cashier-debt-pay-main{display:flex;flex-direction:column;gap:0;min-width:0;}
.client-debt-panel .cashier-debt-pay-main b{font-size:11px;font-weight:900;}
.client-debt-panel .cashier-debt-pay-main em{font-style:normal;font-size:10px;font-weight:800;color:var(--blue);}
.client-debt-panel .cashier-debt-pay-main i{font-style:normal;font-size:9px;color:var(--muted);}
.client-debt-panel .cashier-debt-pay-amt{font-size:12px;font-weight:900;color:var(--green);font-family:'JetBrains Mono',monospace;white-space:nowrap;}
.client-debt-panel .cashier-debts-subtabs{display:flex;gap:4px;flex-wrap:wrap;margin-bottom:6px;flex-shrink:0;}
.client-debt-panel button.cashier-debts-subtab{
  padding:4px 8px;border-radius:999px;font-size:10px;font-weight:800;border:1px solid var(--border);
  background:var(--card2);color:var(--muted);cursor:pointer;
}
.client-debt-panel button.cashier-debts-subtab:hover{color:var(--text);border-color:var(--border);}
.client-debt-panel button.cashier-debts-subtab.on{background:rgba(31,215,96,.12);border-color:var(--green);color:var(--green);}
.client-debt-panel .cashier-debts-body{
  flex:1;min-height:0;overflow-y:auto;overflow-x:hidden;padding:2px 8px 6px;-webkit-overflow-scrolling:touch;
}
.client-debt-panel .cashier-debts-table{width:100%;border-collapse:collapse;font-size:11px;}
.client-debt-panel .cashier-debts-table-wrap{overflow-x:auto;}
.client-debt-panel .cashier-debts-table th{
  text-align:left;font-size:9px;color:var(--muted);font-weight:800;padding:4px 4px;
  border-bottom:1px solid var(--border);position:sticky;top:0;background:var(--card);z-index:1;
}
.client-debt-panel .cashier-debts-table td{padding:5px 4px;border-bottom:1px solid var(--border);vertical-align:middle;}
.client-debt-panel .cashier-debts-table tbody tr:hover{background:rgba(31,215,96,.04);}
.client-debt-panel .cashier-debts-actions{
  display:flex;gap:6px;flex-wrap:wrap;padding:6px 8px;border-top:1px solid var(--border);
  flex-shrink:0;background:var(--panel);
}
.client-debt-panel .cashier-debts-actions .k-btn{
  flex:1;min-width:100px;justify-content:center;min-height:36px;padding:8px 10px;font-size:12px;font-weight:900;
}
.client-debt-panel .hist-empty{padding:20px;text-align:center;color:var(--muted);font-size:12px;}
@media (max-width:900px){
  .client-debt-panel .cashier-debts-hero{grid-template-columns:1fr;}
  .client-debt-panel .cashier-debts-hero-main .kv{font-size:20px;}
  .client-debt-panel .cashier-debt-check-nums{gap:4px;}
  .client-debt-panel .cashier-debt-check-nums > span{min-width:34px;}
  .client-debt-panel .cashier-debt-check-nums b{font-size:9px;}
  .client-debt-panel .cashier-debt-check-st{font-size:8px;}
}
`
