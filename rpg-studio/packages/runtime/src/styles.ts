/** Runtime CSS, injected once. Shared by the studio play-test and the static build. */
export const RUNTIME_CSS = String.raw`
.rpg-root { --rpg-ink:#f4ecd8; --rpg-dim:#c9bfa6; --rpg-win:rgba(20,27,38,.94); --rpg-edge:#e9dcb8; --rpg-accent:#f0c36a; --rpg-hp:#7fc46b; --rpg-low:#e07a5f; --rpg-enemy:#d9745b;
  position:relative; display:flex; flex-direction:column; gap:10px; width:100%; outline:none; color:var(--rpg-ink);
  font-family:"DotGothic16","Hiragino Kaku Gothic ProN","Yu Gothic UI","Meiryo",system-ui,sans-serif; -webkit-tap-highlight-color:transparent; user-select:none; }
.rpg-root:focus-visible .rpg-screen { box-shadow:0 0 0 2px var(--rpg-accent); }
.rpg-screen { position:relative; width:100%; aspect-ratio:640/448; overflow:hidden; background:#0e120f; border-radius:6px; container-type:inline-size; font-size:clamp(11px,2.55cqw,19px); }
.rpg-screen.is-shaking { animation:rpg-shake .22s linear; }
@keyframes rpg-shake { 0%,100%{transform:translate(0,0)} 25%{transform:translate(-4px,2px)} 50%{transform:translate(3px,-2px)} 75%{transform:translate(-2px,1px)} }
.rpg-canvas { position:absolute; inset:0; width:100%; height:100%; image-rendering:pixelated; image-rendering:crisp-edges; }
.rpg-fade { position:absolute; inset:0; background:#000; opacity:0; pointer-events:none; }
.rpg-layer { position:absolute; inset:0; pointer-events:none; }
.rpg-layer > * { pointer-events:auto; }
.rpg-sr { position:absolute; width:1px; height:1px; overflow:hidden; clip-path:inset(50%); }
.rpg-hud { position:absolute; left:2%; top:2.5%; right:2%; display:flex; justify-content:space-between; align-items:flex-start; gap:2%; pointer-events:none; }
.rpg-hud[hidden] { display:none; }
.rpg-hud-left { display:flex; flex-direction:column; gap:.35em; align-items:flex-start; }
.rpg-hud-vars { display:flex; gap:.8em; padding:.25em .7em; background:var(--rpg-win); border:2px solid var(--rpg-edge); border-radius:6px; font-size:.75em; color:var(--rpg-accent); }
.rpg-battle-var { font-size:.75em; color:var(--rpg-accent); margin-top:.3em; }
.rpg-hud-title { padding:.3em .8em; background:var(--rpg-win); border:2px solid var(--rpg-edge); border-radius:6px; font-size:.82em; letter-spacing:.06em; box-shadow:0 2px 0 rgba(0,0,0,.35); }
.rpg-hud-hp { min-width:30%; padding:.35em .7em .45em; background:var(--rpg-win); border:2px solid var(--rpg-edge); border-radius:6px; font-size:.78em; box-shadow:0 2px 0 rgba(0,0,0,.35); }
.rpg-hud-label { display:block; margin-bottom:.3em; white-space:nowrap; }
.rpg-bar { height:.55em; background:rgba(0,0,0,.5); border:1px solid rgba(233,220,184,.5); border-radius:2px; overflow:hidden; }
.rpg-bar-fill { height:100%; background:var(--rpg-hp); transition:width .25s ease; }
.rpg-bar.is-low .rpg-bar-fill { background:var(--rpg-low); }
.rpg-bar.is-enemy .rpg-bar-fill { background:var(--rpg-enemy); }
.rpg-window { background:var(--rpg-win); border:2px solid var(--rpg-edge); border-radius:8px; box-shadow:inset 0 0 0 2px rgba(0,0,0,.45), 0 3px 0 rgba(0,0,0,.35); }
.rpg-message { position:absolute; left:2.5%; right:2.5%; bottom:3%; min-height:26%; padding:.7em 1em 1em; cursor:pointer; line-height:1.65; }
.rpg-speaker { display:inline-block; margin-bottom:.25em; color:var(--rpg-accent); font-size:.85em; letter-spacing:.08em; }
.rpg-text { white-space:pre-wrap; min-height:3.3em; }
.rpg-caret { position:absolute; right:1em; bottom:.5em; font-size:.75em; color:var(--rpg-accent); opacity:0; }
.rpg-caret.is-ready { opacity:1; animation:rpg-blink .8s steps(2) infinite; }
@keyframes rpg-blink { 50% { opacity:0; } }
.rpg-choices { position:absolute; right:2.5%; bottom:33%; min-width:34%; padding:.45em; display:flex; flex-direction:column; gap:.15em; }
.rpg-option { all:unset; box-sizing:border-box; display:flex; align-items:center; justify-content:space-between; gap:1em; padding:.35em .7em .35em 1.4em; border-radius:4px; cursor:pointer; position:relative; font-size:.92em; color:var(--rpg-ink); }
.rpg-option::before { content:"▶"; position:absolute; left:.35em; font-size:.7em; color:var(--rpg-accent); opacity:0; }
.rpg-option.is-selected { background:rgba(240,195,106,.16); }
.rpg-option.is-selected::before { opacity:1; }
.rpg-option:disabled { color:#7d7a70; cursor:default; }
.rpg-option-label { white-space:nowrap; }
.rpg-option-hint { font-size:.75em; color:var(--rpg-dim); white-space:nowrap; }
.rpg-commands[data-grid] .rpg-option-hint { display:none; }
.rpg-root[data-scene="menu"] .rpg-hud { display:none; }
.rpg-root[data-scene="menu"] .rpg-layer { background:rgba(6,9,7,.35); }
.rpg-battle { position:absolute; inset:0; display:flex; flex-direction:column; background-size:cover; background-position:center; image-rendering:pixelated; background:radial-gradient(ellipse at 50% 40%, #3b3a2f 0%, #1c1e19 62%, #101210 100%); animation:rpg-in .25s ease-out; }
@keyframes rpg-in { from { opacity:0; transform:scale(1.04); } }
.rpg-battle-stage { position:relative; flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:.4em; min-height:0; }
.rpg-portrait { width:24%; aspect-ratio:1; image-rendering:pixelated; }
.rpg-enemy-info { width:36%; text-align:center; font-size:.85em; display:flex; flex-direction:column; gap:.3em; }
.rpg-battle-bottom { display:grid; grid-template-columns:1fr 1.6fr 1.2fr; gap:1.5%; padding:0 2.5% 3%; height:38%; }
.rpg-battle-status, .rpg-battle-log, .rpg-commands { padding:.55em .8em; overflow:hidden; }
.rpg-battle-hp { font-size:.85em; margin:.2em 0 .4em; }
.rpg-battle-log { font-size:.8em; line-height:1.55; display:flex; flex-direction:column; justify-content:flex-end; }
.rpg-log-line:last-child { color:var(--rpg-ink); }
.rpg-log-line { color:var(--rpg-dim); }
.rpg-commands { display:grid; grid-template-columns:1fr; align-content:center; gap:.1em; }
.rpg-commands[data-grid] { grid-template-columns:1fr 1fr; }
.rpg-menu { position:absolute; right:2.5%; top:4%; bottom:4%; width:min(58%, 30em); padding:.8em 1em; overflow:auto; display:flex; flex-direction:column; gap:.3em; animation:rpg-in .15s ease-out; }
.rpg-menu-title { color:var(--rpg-accent); letter-spacing:.12em; }
.rpg-menu-stats { font-size:.8em; color:var(--rpg-dim); }
.rpg-menu-section { margin-top:.5em; font-size:.75em; color:var(--rpg-accent); border-bottom:1px solid rgba(233,220,184,.25); padding-bottom:.15em; }
.rpg-menu-empty { font-size:.8em; color:var(--rpg-dim); padding:.2em .5em; }
.rpg-menu-ability { display:flex; flex-direction:column; font-size:.8em; padding:.2em .5em; }
.rpg-menu-ability span { color:var(--rpg-dim); font-size:.9em; }
.rpg-credit-line { font-size:.8em; line-height:1.6; padding:.15em .5em; color:var(--rpg-ink); }
.rpg-menu-row { display:grid; grid-template-columns:1fr 1fr; gap:.1em; }
.rpg-toast { position:absolute; left:50%; top:16%; transform:translateX(-50%); max-width:80%; padding:.5em 1em; background:rgba(14,18,15,.92); border:1px solid var(--rpg-accent); border-radius:6px; font-size:.85em; text-align:center; pointer-events:none; }
.rpg-touch { display:none; justify-content:space-between; align-items:center; padding:0 4px; touch-action:none; }
@media (hover:none) and (pointer:coarse) { .rpg-touch { display:flex; } }
.rpg-root[data-touch="always"] .rpg-touch { display:flex; }
.rpg-dpad { position:relative; width:136px; height:136px; }
.rpg-dpad button, .rpg-ab button { all:unset; position:absolute; display:grid; place-items:center; width:44px; height:44px; border-radius:10px; background:#2b3329; border:1px solid #4d5a47; color:#e9e2cb; font-size:15px; touch-action:none; box-shadow:0 3px 0 #161b15; cursor:pointer; }
.rpg-dpad button:active, .rpg-ab button:active { transform:translateY(2px); box-shadow:0 1px 0 #161b15; }
.rpg-dpad .rpg-dpad-up { left:46px; top:0; } .rpg-dpad .rpg-dpad-down { left:46px; bottom:0; } .rpg-dpad .rpg-dpad-left { left:0; top:46px; } .rpg-dpad .rpg-dpad-right { right:0; top:46px; }
.rpg-ab { position:relative; width:124px; height:84px; }
.rpg-ab button { width:52px; height:52px; border-radius:50%; font-weight:700; }
.rpg-ab .rpg-a { right:0; top:0; background:#5d4a25; border-color:#a1803f; }
.rpg-ab .rpg-b { left:0; bottom:0; }
@media (prefers-reduced-motion: reduce) { .rpg-screen.is-shaking, .rpg-battle, .rpg-menu { animation:none; } .rpg-caret.is-ready { animation:none; } }
`;
