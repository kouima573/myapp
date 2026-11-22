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
.rpg-fps { position:absolute; top:4px; right:4px; z-index:40; padding:3px 5px; border-radius:3px; background:rgba(0,0,0,.72); color:#c8f0bb; font:11px/1.35 ui-monospace,Consolas,monospace; pointer-events:none; white-space:nowrap; }
.rpg-layer { position:absolute; inset:0; pointer-events:none; }
.rpg-input { display:flex; gap:8px; align-items:center; }
.rpg-input-field { flex:1; min-width:0; font:inherit; font-size:18px; padding:6px 10px; border-radius:6px; border:1px solid rgba(255,255,255,.35); background:rgba(0,0,0,.4); color:inherit; }
.rpg-book { max-height:80%; overflow:auto; }
.rpg-confirm { position:absolute; left:50%; top:50%; transform:translate(-50%,-50%); min-width:50%; max-width:80%; padding:1em 1.2em; z-index:20; display:flex; flex-direction:column; gap:.8em; box-shadow:0 0 0 100vmax rgba(0,0,0,.45); }
.rpg-confirm-text { white-space:pre-line; }
.rpg-menu.rpg-skills { position:absolute; left:4%; right:4%; top:4%; bottom:4%; width:auto; max-width:none; max-height:none; left:4%; display:flex; flex-direction:column; gap:.4em; overflow:hidden; }
.rpg-skill-board { position:relative; flex:1; min-height:0; max-height:62%; margin:0 auto; max-width:100%; }
.rpg-root .rpg-hex { position:absolute; transform:translate(-50%,-50%); aspect-ratio:0.866; padding:0; margin:0; display:flex; align-items:center; justify-content:center;
  clip-path:polygon(50% 0, 100% 25%, 100% 75%, 50% 100%, 0 75%, 0 25%); border:none; border-radius:0; font-size:.72em; line-height:1.1; text-align:center; color:#cfd6e6; background:#2a3142; }
.rpg-root .rpg-hex .rpg-option-label { padding:0 12%; }
.rpg-root .rpg-hex::before { display:none; }
.rpg-hex.is-learned { background:linear-gradient(160deg,#ffe8a3,#d8a440); color:#3b2500; font-weight:700; }
.rpg-hex.is-available { background:linear-gradient(160deg,#5a7fc4,#2d4d8c); color:#fff; box-shadow:inset 0 0 0 3px #9fc2ff; }
.rpg-hex.is-short { background:#34405a; color:#aab4cc; }
.rpg-hex.is-locked { background:#1d2230; color:#5f6a80; }
.rpg-hex.is-hidden { background:#151925; color:#7d6aa8; font-size:1em; }
.rpg-hex.is-selected { outline:none; transform:translate(-50%,-50%) scale(1.1); z-index:2; }
.rpg-root .rpg-hex.is-selected::after { content:""; position:absolute; inset:0; background:rgba(255,255,255,.3); box-shadow:inset 0 0 0 4px #fff; pointer-events:none; }
.rpg-skill-detail { min-height:3.6em; padding:.4em .6em; border-top:1px solid rgba(255,255,255,.15); }
.rpg-skill-name { color:var(--rpg-accent); }
.rpg-skill-desc { font-size:.85em; }
.rpg-skill-state { font-size:.78em; color:var(--rpg-dim); }
.rpg-book-row { font-size:13px; line-height:1.6; padding:2px 4px; border-bottom:1px solid rgba(255,255,255,.06); }
.rpg-book-row.is-got { color:#f0c36a; }
.rpg-pictures { position:absolute; inset:0; pointer-events:none; overflow:hidden; }
.rpg-picture { position:absolute; transform:translate(-50%,-50%); height:auto; image-rendering:pixelated; }
.rpg-layer > * { pointer-events:auto; }
.rpg-sr { position:absolute; width:1px; height:1px; overflow:hidden; clip-path:inset(50%); }
.rpg-hud { position:absolute; left:2%; top:2.5%; right:2%; display:flex; justify-content:space-between; align-items:flex-start; gap:2%; pointer-events:none; }
.rpg-hud[hidden] { display:none; }
.rpg-hud-right { display:flex; flex-direction:column; align-items:flex-end; gap:.4em; }
.rpg-minimap { display:block; border:2px solid var(--rpg-edge); border-radius:4px; image-rendering:pixelated; opacity:.9; background:#111; max-width:100%; }
.rpg-enemy-row { display:flex; flex-direction:column; gap:.2em; margin-bottom:.35em; }
.rpg-enemy-row.is-down { opacity:.4; }
.rpg-verbs { display:flex; flex-wrap:wrap; gap:.3em; pointer-events:auto; max-width:60vw; }
.rpg-root .rpg-verb { padding:.2em .6em; background:var(--rpg-win); border:2px solid var(--rpg-edge); border-radius:6px; color:var(--rpg-ink); font:inherit; font-size:.72em; cursor:pointer; }
.rpg-root .rpg-verb:hover, .rpg-root .rpg-verb:focus-visible { border-color:var(--rpg-accent); color:var(--rpg-accent); }
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
.rpg-bar.is-mp .rpg-bar-fill { background:#4e9bd0; }
.rpg-bar.is-sp .rpg-bar-fill { background:#b17aca; }
.rpg-root[data-color-assist="true"] .rpg-bar { outline:1px solid #fff; }
.rpg-root[data-color-assist="true"] .rpg-bar.is-low .rpg-bar-fill { background-image:repeating-linear-gradient(135deg, rgba(0,0,0,.75) 0 2px, transparent 2px 5px); }
.rpg-window { background:var(--rpg-win); border:2px solid var(--rpg-edge); border-radius:var(--rpg-radius,8px); box-shadow:inset 0 0 0 2px rgba(0,0,0,.45), 0 3px 0 rgba(0,0,0,.35); }
.rpg-message { position:absolute; left:2.5%; right:2.5%; bottom:3%; min-height:26%; padding:.7em 1em 1em; cursor:pointer; line-height:1.65; }
.rpg-speaker { display:inline-block; margin-bottom:.25em; color:var(--rpg-accent); font-size:.85em; letter-spacing:.08em; }
.rpg-text { white-space:pre-wrap; min-height:3.3em; }
.rpg-t-b { font-weight:700; }
.rpg-t-big { font-size:1.35em; }
.rpg-t-small { font-size:.8em; }
.rpg-t-letter { display:inline-block; white-space:pre; }
.rpg-t-shake .rpg-t-letter { animation: rpg-t-shake .18s steps(2) infinite; }
.rpg-t-wave .rpg-t-letter { animation: rpg-t-wave 1s ease-in-out infinite; }
@keyframes rpg-t-shake { 0% { transform: translate(0,0); } 50% { transform: translate(1px,-1px); } 100% { transform: translate(-1px,1px); } }
@keyframes rpg-t-wave { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-3px); } }
@media (prefers-reduced-motion: reduce) { .rpg-t-letter { animation: none !important; } }
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
.rpg-battle { position:absolute; inset:0; display:flex; flex-direction:column; background:radial-gradient(ellipse at 50% 40%, #3b3a2f 0%, #1c1e19 62%, #101210 100%); background-size:cover; background-position:center; background-repeat:no-repeat; image-rendering:pixelated; animation:rpg-in .25s ease-out; }
@keyframes rpg-in { from { opacity:0; transform:scale(1.04); } }
.rpg-battle-stage { position:relative; flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:.4em; min-height:0; }
.rpg-portraits { display:flex; justify-content:center; align-items:flex-end; gap:2%; width:100%; }
.rpg-portrait-wrap { position:relative; width:24%; aspect-ratio:1; }
.rpg-portrait-wrap.is-group { width:18%; }
.rpg-portrait { width:100%; height:100%; image-rendering:pixelated; }
.rpg-portrait.is-group { width:100%; }
.rpg-battle-status { position:relative; }
/* Battle animations (data: animation on weapons, skills, items, enemy actions). */
.rpg-fx { position:absolute; inset:0; pointer-events:none; animation-duration:.8s; animation-fill-mode:forwards; animation-timing-function:ease-out; }
.rpg-fx-slash { background:linear-gradient(135deg, transparent 44%, rgba(255,255,255,.95) 48%, rgba(255,255,255,.95) 52%, transparent 56%); animation-name:rpg-fx-slash; }
.rpg-fx-pierce { background:radial-gradient(circle at 50% 50%, rgba(255,255,255,.95) 0 6%, transparent 8%), linear-gradient(90deg, transparent 30%, rgba(255,255,255,.8) 50%, transparent 70%) center/100% 6% no-repeat; animation-name:rpg-fx-pop; }
.rpg-fx-hit { background:radial-gradient(circle, rgba(255,240,200,.95) 0 12%, rgba(255,160,80,.6) 20%, transparent 36%); animation-name:rpg-fx-pop; }
.rpg-fx-magic { background:radial-gradient(circle, rgba(220,180,255,.9) 0 10%, rgba(140,90,255,.55) 30%, transparent 55%); animation-name:rpg-fx-swell; }
.rpg-fx-fire { background:radial-gradient(ellipse at 50% 70%, rgba(255,240,140,.95) 0 10%, rgba(255,120,40,.8) 28%, rgba(200,40,20,.4) 45%, transparent 60%); animation-name:rpg-fx-flicker; }
.rpg-fx-ice { background:conic-gradient(from 0deg, rgba(200,240,255,.9) 0 5%, transparent 5% 12.5%, rgba(200,240,255,.9) 12.5% 17.5%, transparent 17.5% 25%, rgba(200,240,255,.9) 25% 30%, transparent 30% 37.5%, rgba(200,240,255,.9) 37.5% 42.5%, transparent 42.5% 50%, rgba(200,240,255,.9) 50% 55%, transparent 55% 62.5%, rgba(200,240,255,.9) 62.5% 67.5%, transparent 67.5% 75%, rgba(200,240,255,.9) 75% 80%, transparent 80% 87.5%, rgba(200,240,255,.9) 87.5% 92.5%, transparent 92.5%); border-radius:50%; animation-name:rpg-fx-swell; }
.rpg-fx-thunder { background:linear-gradient(100deg, transparent 45%, rgba(255,250,150,1) 47%, transparent 50%), linear-gradient(80deg, transparent 50%, rgba(255,250,150,1) 52%, transparent 55%); animation-name:rpg-fx-flash; }
.rpg-fx-heal { background:radial-gradient(circle at 30% 80%, rgba(160,255,170,.9) 0 4%, transparent 5%), radial-gradient(circle at 60% 60%, rgba(160,255,170,.9) 0 4%, transparent 5%), radial-gradient(circle at 45% 40%, rgba(200,255,200,.9) 0 3%, transparent 4%), radial-gradient(circle, rgba(120,230,140,.35) 0 30%, transparent 55%); animation-name:rpg-fx-rise; }
.rpg-fx-explosion { background:radial-gradient(circle, rgba(255,255,220,1) 0 8%, rgba(255,170,60,.9) 20%, rgba(180,60,20,.6) 36%, transparent 52%); animation-name:rpg-fx-boom; }
.rpg-fx-poison { background:radial-gradient(circle at 35% 60%, rgba(170,90,200,.8) 0 8%, transparent 10%), radial-gradient(circle at 65% 45%, rgba(170,90,200,.8) 0 6%, transparent 8%), radial-gradient(circle, rgba(140,60,170,.4) 0 30%, transparent 50%); animation-name:rpg-fx-rise; }
@keyframes rpg-fx-slash { 0% { clip-path:inset(0 100% 100% 0); opacity:1; } 45% { clip-path:inset(0 0 0 0); opacity:1; } 100% { clip-path:inset(0 0 0 0); opacity:0; } }
@keyframes rpg-fx-pop { 0% { transform:scale(.3); opacity:1; } 60% { opacity:1; } 100% { transform:scale(1.25); opacity:0; } }
@keyframes rpg-fx-swell { 0% { transform:scale(.2) rotate(0); opacity:0; } 30% { opacity:1; } 100% { transform:scale(1.3) rotate(40deg); opacity:0; } }
@keyframes rpg-fx-flicker { 0%,100% { opacity:0; transform:scale(.6); } 15%,55% { opacity:1; transform:scale(1.05); } 35% { opacity:.7; transform:scale(.95); } }
@keyframes rpg-fx-flash { 0%,30%,60% { opacity:1; } 15%,45%,100% { opacity:0; } }
@keyframes rpg-fx-rise { 0% { transform:translateY(20%); opacity:0; } 30% { opacity:1; } 100% { transform:translateY(-25%); opacity:0; } }
@keyframes rpg-fx-boom { 0% { transform:scale(.1); opacity:1; } 50% { opacity:1; } 100% { transform:scale(1.6); opacity:0; } }
@media (prefers-reduced-motion: reduce) { .rpg-fx { animation-duration:.01s !important; } }
.rpg-enemy-info { width:36%; text-align:center; font-size:.85em; display:flex; flex-direction:column; gap:.3em; }
.rpg-battle-bottom { display:grid; grid-template-columns:1fr 1.6fr 1.2fr; gap:1.5%; padding:0 2.5% 3%; height:38%; }
.rpg-battle-status, .rpg-battle-log, .rpg-commands { padding:.55em .8em; overflow:hidden; }
.rpg-battle-hp { font-size:.85em; margin:.2em 0 .4em; }
.rpg-battle-resource { font-size:.72em; margin-top:.25em; }
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
.rpg-scene { position:absolute; inset:0; pointer-events:auto; }
.rpg-realtime { position:absolute; inset:0; width:100%; height:100%; image-rendering:pixelated; }
.rpg-root[data-scene="ending"] .rpg-layer { background:rgba(4,6,5,.72); }
.rpg-ending { position:absolute; left:10%; right:10%; top:14%; bottom:14%; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:.6em; padding:1.2em; text-align:center; animation:rpg-in .6s ease-out; }
.rpg-root.has-frame .rpg-window { border-style:solid; border-width:calc(var(--rpg-frame-slice) * 1px); border-image:var(--rpg-frame) var(--rpg-frame-slice) fill / calc(var(--rpg-frame-slice) * 1px) stretch; background:transparent; box-shadow:none; image-rendering:pixelated; }
.rpg-gameover { background-size:cover; background-position:center; }
.rpg-gameover-title { color:#e0604a; font-size:2em; letter-spacing:.2em; text-shadow:0 2px 0 #000; }
.rpg-ending-label { letter-spacing:.4em; color:var(--rpg-accent); font-size:.8em; }
.rpg-ending-title { font-size:1.5em; letter-spacing:.1em; }
.rpg-message.has-face { padding-left:calc(1em + 6.2em); min-height:6.6em; }
.rpg-face { position:absolute; left:.8em; top:50%; transform:translateY(-50%); width:5.6em; height:5.6em; image-rendering:pixelated; border:2px solid rgba(233,220,184,.45); border-radius:6px; background:rgba(0,0,0,.35); }
.rpg-pop { position:absolute; left:50%; top:30%; z-index:6; pointer-events:none; font-size:1.6em; font-weight:700; color:#fff2c4; text-shadow:0 2px 0 #000, 0 0 6px rgba(0,0,0,.8); transform:translate(calc(-50% + var(--dx, 0px)), 0); animation:rpg-pop .9s ease-out forwards; }
.rpg-pop.is-player { top:62%; left:22%; color:#ff9a8a; }
@keyframes rpg-pop { 0% { opacity:0; transform:translate(calc(-50% + var(--dx, 0px)), .4em) scale(.8); } 15% { opacity:1; transform:translate(calc(-50% + var(--dx, 0px)), 0) scale(1.15); } 70% { opacity:1; } 100% { opacity:0; transform:translate(calc(-50% + var(--dx, 0px)), -1.4em) scale(1); } }
.rpg-title { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:.6em; border-radius:0; background:radial-gradient(ellipse at center, rgba(28,38,30,.92), rgba(8,11,9,.97)); background-size:cover; background-position:center; animation:rpg-in .3s ease-out; }
.rpg-title-name { font-size:2.2em; letter-spacing:.12em; text-align:center; text-shadow:0 2px 0 rgba(0,0,0,.6); padding:0 .5em; }
.rpg-title-sub { opacity:.8; letter-spacing:.08em; }
.rpg-title-menu { margin-top:1.4em; display:flex; flex-direction:column; gap:.35em; min-width:min(70%, 14em); }
.rpg-ending-text { white-space:pre-wrap; line-height:1.8; color:var(--rpg-dim); max-width:32em; }
.rpg-ending-meta { font-size:.75em; color:var(--rpg-dim); }
.rpg-credit-line { font-size:.8em; line-height:1.6; padding:.15em .5em; color:var(--rpg-ink); }
.rpg-menu-row { display:grid; grid-template-columns:1fr 1fr; gap:.1em; }
.rpg-audio-controls { display:grid; grid-template-columns:1fr 1fr; gap:.5em; padding:.3em 0; }
.rpg-audio-control { display:flex; flex-direction:column; gap:.15em; font-size:.8em; }
.rpg-audio-control input[type="range"] { padding:0; accent-color:var(--rpg-accent); }
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
[data-reduced-motion="true"] .rpg-menu, [data-reduced-motion="true"] .rpg-battle, [data-reduced-motion="true"] .rpg-caret.is-ready { animation:none !important; }
`;
