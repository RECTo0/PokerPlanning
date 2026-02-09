import { firebaseConfig } from "./firebase.js";

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore, doc, setDoc, getDoc, updateDoc, deleteDoc,
  collection, getDocs, onSnapshot, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// ====== CONFIG ======
const FIBO = ["0,5","1","2","3","5","8","13","20","40","100","?","☕"];
const ALLOW_EVERYONE_KICK = true; // comme tu voulais
// =====================

// UI
const joinView = document.getElementById("joinView");
const roomView = document.getElementById("roomView");
const roomHint = document.getElementById("roomHint");

const roomIdInput = document.getElementById("roomIdInput");
const nameInput = document.getElementById("nameInput");
const joinBtn = document.getElementById("joinBtn");

const roomTitle = document.getElementById("roomTitle");
const roomStatus = document.getElementById("roomStatus");
const roundPill = document.getElementById("roundPill");
const revealPill = document.getElementById("revealPill");
const whoami = document.getElementById("whoami");

const playersList = document.getElementById("playersList");
const cardsEl = document.getElementById("cards");
const resultsEl = document.getElementById("results");
const voteHint = document.getElementById("voteHint");
const resultHint = document.getElementById("resultHint");

const revealBtn = document.getElementById("revealBtn");
const resetBtn = document.getElementById("resetBtn");
const leaveBtn = document.getElementById("leaveBtn");

const fxLayer = document.getElementById("fxLayer");
const toastEl = document.getElementById("toast");

let state = {
  roomId: null,
  playerId: null,
  name: null,
  role: null, // player | observer
  isFacilitator: false,
  facilitatorId: null,
  revealed: false,
  round: 1,
  selected: null,
  unsub: []
};

// cache votes
let latestVotes = [];

// helpers
function uid() {
  return crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2);
}
function sanitizeRoomId(s) {
  return (s || "").trim().toLowerCase().replace(/[^a-z0-9-_]/g, "-").slice(0, 40);
}
function getRole() {
  return document.querySelector('input[name="role"]:checked')?.value || "player";
}
function initials(name){
  const n = (name || "?").trim();
  if (!n) return "?";
  const parts = n.split(/\s+/).filter(Boolean);
  const a = parts[0]?.[0] || "?";
  const b = parts[1]?.[0] || "";
  return (a + b).toUpperCase();
}
function toast(msg){
  toastEl.textContent = msg;
  toastEl.classList.remove("hidden");
  clearTimeout(toastEl._t);
  toastEl._t = setTimeout(() => toastEl.classList.add("hidden"), 1500);
}

function roomRef(roomId){ return doc(db, "rooms", roomId); }
function playersCol(roomId){ return collection(db, "rooms", roomId, "players"); }
function votesCol(roomId){ return collection(db, "rooms", roomId, "votes"); }
function playerRef(roomId, playerId){ return doc(db, "rooms", roomId, "players", playerId); }
function voteRef(roomId, playerId){ return doc(db, "rooms", roomId, "votes", playerId); }

function showRoom(roomId){
  joinView.classList.add("hidden");
  roomView.classList.remove("hidden");
  roomHint.textContent = `Room: ${roomId}`;
  roomTitle.textContent = `Room: ${roomId}`;
}
function showJoin(){
  roomView.classList.add("hidden");
  joinView.classList.remove("hidden");
  roomHint.textContent = "";
}
function clearUnsubs(){
  state.unsub.forEach(fn => { try{ fn(); }catch{} });
  state.unsub = [];
}

function setPills(){
  roundPill.textContent = `Round ${state.round || 1}`;
  revealPill.textContent = state.revealed ? "Reveal ON" : "Reveal OFF";
  revealPill.style.borderColor = state.revealed ? "rgba(34,197,94,.35)" : "rgba(255,255,255,.14)";
  revealPill.style.background = state.revealed ? "rgba(34,197,94,.10)" : "rgba(0,0,0,.18)";
}

// color logic: same value => same color
function hashToHue(str){
  let h = 0;
  for (let i=0; i<str.length; i++) h = (h*31 + str.charCodeAt(i)) >>> 0;
  return h % 360;
}
function colorForValue(val){
  const hue = hashToHue(String(val));
  return `hsl(${hue} 70% 60% / 0.45)`;
}

// FX
function clearFx(){
  fxLayer.innerHTML = "";
}
function fireworks(){
  clearFx();
  const bursts = 4;
  const particlesPerBurst = 22;

  for (let b=0; b<bursts; b++){
    const ox = 20 + Math.random()*60; // %
    const oy = 25 + Math.random()*45; // %

    for (let i=0; i<particlesPerBurst; i++){
      const p = document.createElement("div");
      p.className = "particle";

      const angle = (Math.PI*2) * (i/particlesPerBurst);
      const dist = 40 + Math.random()*90;

      const dx = Math.cos(angle) * dist;
      const dy = Math.sin(angle) * dist;

      const hue = Math.floor(Math.random()*360);

      p.style.left = `${ox}%`;
      p.style.top = `${oy}%`;
      p.style.background = `hsl(${hue} 80% 60%)`;
      p.style.setProperty("--dx", `${dx}px`);
      p.style.setProperty("--dy", `${dy}px`);

      fxLayer.appendChild(p);
    }
  }

  setTimeout(clearFx, 1100);
}

function showUnicornMessageThenRender(renderFn){
  clearFx();
  resultsEl.innerHTML = `<div class="unicorn">🦄 <span>Pas d’accord ? La licorne exige un débat civilisé.</span></div>`;
  // garde 4s
  setTimeout(() => {
    renderFn();
  }, 4000);
}

// Cards
function renderCards(){
  cardsEl.innerHTML = "";
  FIBO.forEach(v => {
    const c = document.createElement("div");
    c.className = "pcard" + (state.selected === v ? " selected" : "");
    c.innerHTML = `
      <div class="mini">${v}</div>
      <div class="v">${v}</div>
      <div class="mini r">${v}</div>
    `;
    c.onclick = async () => {
      if (state.role !== "player") return;
      if (state.revealed) { toast("Reveal actif"); return; }
      state.selected = v;
      renderCards();
      await castVote(v);
      toast(`OK`);
    };
    cardsEl.appendChild(c);
  });
}

async function castVote(value){
  const rId = state.roomId;
  const pId = state.playerId;

  await setDoc(voteRef(rId, pId), { value, updatedAt: serverTimestamp() }, { merge: true });
  await setDoc(playerRef(rId, pId), { hasVoted: true, updatedAt: serverTimestamp() }, { merge: true });
}

// Join
async function joinRoom(){
  const name = (nameInput.value || "").trim().slice(0,24);
  if (!name) { alert("Entre un pseudo."); return; }

  let roomId = sanitizeRoomId(roomIdInput.value);
  if (!roomId) roomId = "room-" + Math.random().toString(36).slice(2,8);

  const role = getRole();
  const playerId = uid();

  state.roomId = roomId;
  state.playerId = playerId;
  state.name = name;
  state.role = role;
  state.selected = null;

  const r = roomRef(roomId);
  const snap = await getDoc(r);

  if (!snap.exists()){
    await setDoc(r, {
      createdAt: serverTimestamp(),
      revealed: false,
      facilitatorId: playerId,
      round: 1
    });
    state.isFacilitator = true;
    state.facilitatorId = playerId;
    state.round = 1;
  } else {
    const data = snap.data();
    state.facilitatorId = data.facilitatorId;
    state.isFacilitator = data.facilitatorId === playerId;
    state.round = data.round || 1;
  }

  await setDoc(playerRef(roomId, playerId), {
    name,
    role,
    hasVoted: false,
    joinedAt: serverTimestamp()
  }, { merge: true });

  showRoom(roomId);
  bindRoom();
}

async function kickPlayer(targetId){
  const canKick = ALLOW_EVERYONE_KICK || state.isFacilitator;
  if (!canKick) return;
  if (targetId === state.playerId) return;

  try { await deleteDoc(voteRef(state.roomId, targetId)); } catch {}
  try { await deleteDoc(playerRef(state.roomId, targetId)); } catch {}
  toast("Kick");
}

// Render results (with same-value color)
async function renderResultsFromVotes(votes){
  if (!state.revealed){
    resultsEl.textContent = "En attente…";
    return;
  }

  if (!votes || votes.length === 0){
    resultsEl.textContent = "Aucun vote.";
    return;
  }

  // map names & roles
  const ps = await getDocs(playersCol(state.roomId));
  const players = [];
  ps.forEach(d => players.push({ id: d.id, ...d.data() }));

  const nameById = new Map(players.map(p => [p.id, p.name || p.id]));

  // sort by name
  const sorted = [...votes].sort((a,b) =>
    String(nameById.get(a.id) || a.id).localeCompare(String(nameById.get(b.id) || b.id))
  );

  // compute vote counts (to apply same color if >=2)
  const counts = new Map();
  for (const v of sorted){
    const key = String(v.value ?? "—");
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  const wrap = document.createElement("div");
  wrap.className = "votecards";

  sorted.forEach(v => {
    const val = v.value ?? "—";
    const key = String(val);
    const n = counts.get(key) || 0;

    const card = document.createElement("div");
    card.className = "votecard";

    // if duplicated => colorize
    if (n >= 2){
      card.style.borderColor = "rgba(255,255,255,.22)";
      card.style.background = colorForValue(key);
    }

    const inner = document.createElement("div");
    inner.className = "inner";

    const back = document.createElement("div");
    back.className = "face back";
    back.textContent = "🂠";

    const front = document.createElement("div");
    front.className = "face front";
    front.textContent = val;

    const nm = document.createElement("div");
    nm.className = "nm";
    nm.textContent = nameById.get(v.id) || v.id;

    inner.appendChild(back);
    inner.appendChild(front);
    card.appendChild(inner);
    card.appendChild(nm);

    wrap.appendChild(card);
  });

  resultsEl.innerHTML = "";
  resultsEl.appendChild(wrap);
}

// Reveal behavior:
// - if all same => fireworks + show results right away
// - else => unicorn 4s then show results
function handleRevealEffects(){
  if (!state.revealed) return;

  // values only (ignore observers who didn't vote)
  const vals = latestVotes.map(v => String(v.value ?? "—"));
  const unique = new Set(vals);

  resultHint.textContent = ""; // pas de texte "flip animé..."

  if (vals.length > 0 && unique.size === 1){
    fireworks();
    renderResultsFromVotes(latestVotes);
  } else {
    showUnicornMessageThenRender(() => renderResultsFromVotes(latestVotes));
  }
}

function bindRoom(){
  clearUnsubs();
  renderCards();

  // Reset : facilitateur seulement (tu peux le laisser, c’est plus safe)
  resetBtn.classList.remove("hidden");

  // pas de badge facilitateur visible, mais on garde "whoami" simple
  whoami.textContent = `${state.name} • ${state.role === "observer" ? "Observateur" : "Joueur"}`;

  // supprimer les hints que tu ne veux pas voir
  voteHint.textContent = "";
  resultHint.textContent = "";

  // room state
  state.unsub.push(onSnapshot(roomRef(state.roomId), (d) => {
    if (!d.exists()) return;
    const data = d.data();

    state.revealed = !!data.revealed;
    state.round = data.round || 1;
    state.facilitatorId = data.facilitatorId;

    roomStatus.textContent = state.revealed ? "" : "";

    revealBtn.textContent = state.revealed ? "Hide" : "Reveal";
    setPills();

    if (!state.revealed){
      clearFx();
      resultsEl.textContent = "En attente…";
    } else {
      handleRevealEffects();
    }
  }));

  // players
  state.unsub.push(onSnapshot(playersCol(state.roomId), (qs) => {
    const players = [];
    qs.forEach(docu => players.push({ id: docu.id, ...docu.data() }));
    players.sort((a,b) => (a.name||"").localeCompare(b.name||""));

    playersList.innerHTML = "";
    players.forEach(p => {
      const li = document.createElement("li");
      li.className = "player";

      const left = document.createElement("div");
      left.className = "pLeft";

      const av = document.createElement("div");
      av.className = "avatar";
      av.textContent = initials(p.name);

      const nm = document.createElement("div");
      nm.className = "pName";
      nm.textContent = p.name || "—";

      left.appendChild(av);
      left.appendChild(nm);

      const tags = document.createElement("div");
      tags.className = "tags";

      // ❌ pas de badge "facilitateur"

      const roleTag = document.createElement("span");
      roleTag.className = "tag";
      roleTag.textContent = p.role === "observer" ? "👀 Observateur" : "🎯 Joueur";
      tags.appendChild(roleTag);

      const voteTag = document.createElement("span");
      voteTag.className = "tag " + (p.role === "observer" ? "wait" : (p.hasVoted ? "ok" : "wait"));
      voteTag.textContent = p.role === "observer" ? "—" : (p.hasVoted ? "A voté ✅" : "…");
      tags.appendChild(voteTag);

      const canKick = (ALLOW_EVERYONE_KICK || state.isFacilitator) && (p.id !== state.playerId);
      if (canKick){
        const kb = document.createElement("button");
        kb.className = "kick";
        kb.textContent = "Kick";
        kb.onclick = () => kickPlayer(p.id);
        tags.appendChild(kb);
      }

      li.appendChild(left);
      li.appendChild(tags);
      playersList.appendChild(li);
    });
  }));

  // votes cache + render on reveal
  state.unsub.push(onSnapshot(votesCol(state.roomId), (qs) => {
    const votes = [];
    qs.forEach(docu => votes.push({ id: docu.id, ...docu.data() }));
    latestVotes = votes;

    // si reveal déjà ON, on applique l’effet (unicorn/fireworks) + render
    if (state.revealed){
      handleRevealEffects();
    }
  }));
}

// Reveal toggle (tout le monde)
async function revealToggle(){
  const r = roomRef(state.roomId);
  const snap = await getDoc(r);
  if (!snap.exists()) return;
  const cur = !!snap.data().revealed;
  await updateDoc(r, { revealed: !cur });
}

// Reset (facilitateur)
async function reset(){
  

  const vs = await getDocs(votesCol(state.roomId));
  for (const v of vs.docs) await deleteDoc(v.ref);

  const ps = await getDocs(playersCol(state.roomId));
  for (const p of ps.docs) await updateDoc(p.ref, { hasVoted: false });

  const rSnap = await getDoc(roomRef(state.roomId));
  const nextRound = (rSnap.exists() ? (rSnap.data().round || 1) : 1) + 1;

  await updateDoc(roomRef(state.roomId), { revealed: false, round: nextRound });

  state.selected = null;
  latestVotes = [];
  clearFx();
  renderCards();
  resultsEl.textContent = "En attente…";
  toast("Reset");
}

async function leave(){
  try{ await deleteDoc(playerRef(state.roomId, state.playerId)); } catch {}
  try{ await deleteDoc(voteRef(state.roomId, state.playerId)); } catch {}
  clearUnsubs();
  latestVotes = [];
  clearFx();
  state = { roomId:null, playerId:null, name:null, role:null, isFacilitator:false, facilitatorId:null, revealed:false, round:1, selected:null, unsub:[] };
  showJoin();
}

// Events
joinBtn.onclick = joinRoom;
revealBtn.onclick = revealToggle;
resetBtn.onclick = reset;
leaveBtn.onclick = leave;

// URL ?room=xxx
const params = new URLSearchParams(location.search);
const roomFromUrl = sanitizeRoomId(params.get("room"));
if (roomFromUrl) roomIdInput.value = roomFromUrl;


