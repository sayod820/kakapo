/** Стили панели долга клиента (как в кассе) — для Торговля / Долги */
export const CLIENT_DEBT_PANEL_CSS = `
.client-debt-panel{
  display:flex;flex-direction:column;flex:1;min-height:0;overflow:hidden;
}
.client-debt-panel .cashier-debts-hero{
  display:grid;grid-template-columns:1.4fr 1fr;gap:10px;margin:0 0 8px;flex-shrink:0;
}
.client-debt-panel .cashier-debts-hero-main{
  padding:12px 14px;border-radius:14px;background:rgba(255,90,90,.08);
  border:1px solid rgba(255,90,90,.28);
}
.client-debt-panel .cashier-debts-hero-main .kl{font-size:12px;color:var(--muted);font-weight:800;}
.client-debt-panel .cashier-debts-hero-main .kv{font-size:28px;font-weight:900;margin-top:4px;line-height:1.1;font-family:'JetBrains Mono',monospace;}
.client-debt-panel .cashier-debts-hero-cur{font-size:14px;font-weight:800;margin-left:4px;opacity:.85;}
.client-debt-panel .cashier-debts-hero-main .kh{font-size:11px;color:var(--muted);margin-top:6px;line-height:1.35;}
.client-debt-panel .cashier-debts-hero-side{
  display:flex;flex-direction:column;gap:6px;padding:10px 12px;border-radius:14px;
  background:var(--card2);border:1px solid var(--border);
}
.client-debt-panel .cashier-debts-hero-side > div{display:flex;justify-content:space-between;align-items:baseline;gap:8px;}
.client-debt-panel .cashier-debts-hero-side .kl{font-size:11px;color:var(--muted);font-weight:700;}
.client-debt-panel .cashier-debts-hero-side b{font-size:14px;font-family:'JetBrains Mono',monospace;}
.client-debt-panel .cashier-debts-split{
  display:flex;flex-wrap:wrap;gap:8px 14px;margin:0 0 10px;font-size:12px;color:var(--muted);flex-shrink:0;
}
.client-debt-panel .cashier-debts-split b{font-family:'JetBrains Mono',monospace;}
.client-debt-panel .cashier-debt-hint{font-size:11px;color:var(--muted);margin:0 0 8px;line-height:1.3;}
.client-debt-panel .cashier-debt-sec{font-size:10px;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:.03em;margin:8px 0 4px;}
.client-debt-panel button.cashier-debt-check,.client-debt-panel .cashier-debt-check{
  display:flex;align-items:flex-start;gap:8px;width:100%;text-align:left;margin:0 0 4px;padding:7px 10px;
  border-radius:10px;border:1px solid var(--border);background:var(--card2);color:inherit;cursor:pointer;
}
.client-debt-panel button.cashier-debt-check:hover{border-color:var(--green);}
.client-debt-panel .cashier-debt-check-id{display:flex;flex-direction:column;gap:1px;min-width:0;flex:1 1 140px;}
.client-debt-panel .cashier-debt-check-id b{font-size:12px;font-weight:900;white-space:nowrap;}
.client-debt-panel .cashier-debt-check-id em{font-style:normal;font-size:10px;color:var(--muted);white-space:nowrap;}
.client-debt-panel .cashier-debt-check-note{
  font-style:normal!important;font-size:10px!important;font-weight:700!important;color:var(--gold)!important;
  max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:1px;
}
.client-debt-panel .cashier-debt-check-st{font-size:11px;font-weight:800;white-space:nowrap;flex-shrink:0;margin-left:auto;padding-top:2px;}
.client-debt-panel .cashier-debt-check-nums{
  display:flex;gap:10px;flex-shrink:0;align-items:flex-start;
}
.client-debt-panel .cashier-debt-check-nums > span{display:flex;flex-direction:column;align-items:flex-end;gap:0;line-height:1.15;}
.client-debt-panel .cashier-debt-check-nums i{font-style:normal;font-size:9px;color:var(--muted);font-weight:700;}
.client-debt-panel .cashier-debt-check-nums b{font-size:12px;font-family:'JetBrains Mono',monospace;font-weight:900;}
.client-debt-panel .cashier-debt-pays{display:flex;flex-direction:column;gap:4px;}
.client-debt-panel button.cashier-debt-pay,.client-debt-panel .cashier-debt-pay{
  display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%;text-align:left;
  margin:0 0 4px;padding:8px 10px;border-radius:10px;border:1px solid var(--border);
  background:var(--card2);color:inherit;cursor:pointer;
}
.client-debt-panel .cashier-debt-pay-main{display:flex;flex-direction:column;gap:1px;min-width:0;}
.client-debt-panel .cashier-debt-pay-main b{font-size:12px;font-weight:900;}
.client-debt-panel .cashier-debt-pay-main em{font-style:normal;font-size:11px;font-weight:800;color:var(--blue);}
.client-debt-panel .cashier-debt-pay-main i{font-style:normal;font-size:10px;color:var(--muted);}
.client-debt-panel .cashier-debt-pay-amt{font-size:13px;font-weight:900;color:var(--green);font-family:'JetBrains Mono',monospace;white-space:nowrap;}
.client-debt-panel .cashier-debts-subtabs{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px;flex-shrink:0;}
.client-debt-panel button.cashier-debts-subtab{
  padding:6px 10px;border-radius:999px;font-size:11px;font-weight:800;border:1px solid var(--border);
  background:var(--card2);color:var(--muted);cursor:pointer;
}
.client-debt-panel button.cashier-debts-subtab:hover{color:var(--text);border-color:var(--border);}
.client-debt-panel button.cashier-debts-subtab.on{background:rgba(31,215,96,.12);border-color:var(--green);color:var(--green);}
.client-debt-panel .cashier-debts-body{flex:1;min-height:0;overflow-y:auto;overflow-x:hidden;padding:4px 0 8px;-webkit-overflow-scrolling:touch;}
.client-debt-panel .cashier-debts-table{width:100%;border-collapse:collapse;font-size:12px;}
.client-debt-panel .cashier-debts-table-wrap{overflow-x:auto;}
.client-debt-panel .cashier-debts-table th{text-align:left;font-size:10px;color:var(--muted);font-weight:800;padding:6px 5px;border-bottom:1px solid var(--border);position:sticky;top:0;background:var(--card);z-index:1;}
.client-debt-panel .cashier-debts-table td{padding:7px 5px;border-bottom:1px solid var(--border);vertical-align:middle;}
.client-debt-panel .cashier-debts-table tbody tr:hover{background:rgba(31,215,96,.04);}
.client-debt-panel .cashier-debts-actions{display:flex;gap:8px;flex-wrap:wrap;padding:8px 10px;border-top:1px solid var(--border);flex-shrink:0;background:var(--panel);}
.client-debt-panel .cashier-debts-actions .k-btn{flex:1;min-width:120px;justify-content:center;min-height:40px;padding:10px 12px;font-size:13px;font-weight:900;}
.client-debt-panel .hist-empty{padding:24px;text-align:center;color:var(--muted);font-size:13px;}
@media (max-width:900px){
  .client-debt-panel .cashier-debts-hero{grid-template-columns:1fr;}
  .client-debt-panel .cashier-debts-hero-main .kv{font-size:24px;}
  .client-debt-panel .cashier-debt-check-id{flex:0 1 96px;}
  .client-debt-panel .cashier-debt-check-nums{gap:6px;}
  .client-debt-panel .cashier-debt-check-nums b{font-size:11px;}
}
`
