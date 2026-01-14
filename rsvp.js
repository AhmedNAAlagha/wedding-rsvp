const GOOGLE_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbxJwkpVXeXLq65OOZjHo4MD9ZMnjS_N_xerl6Nov8-DJEqqREtQ2uNcjYxJbI9yzTTN/exec";

let guests = [];
let currentMatch = null;

async function loadGuests() {
  const res = await fetch("guests.json", { cache: "no-store" });
  guests = await res.json();
}

function norm(s) {
  return (s || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

// Simple similarity score: exact match > token overlap > starts-with bonus
function score(a, b) {
  a = norm(a);
  b = norm(b);
  if (!a || !b) return 0;
  if (a === b) return 1;

  const A = new Set(a.split(" "));
  const B = new Set(b.split(" "));

  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;

  const union = new Set([...A, ...B]).size;
  const startBonus = (b.startsWith(a) || a.startsWith(b)) ? 0.15 : 0;

  return (inter / union) + startBonus;
}

function findBestMatch(query) {
  const q = norm(query);
  let best = null;
  let bestScore = -1;

  for (const g of guests) {
    const s = score(q, g.name);
    if (s > bestScore) {
      bestScore = s;
      best = g;
    }
  }
  return { best, bestScore };
}

function setText(id, msg) {
  document.getElementById(id).textContent = msg || "";
}

function showMatch(match) {
  currentMatch = match;

  document.getElementById("matchedName").textContent = match.name;
  document.getElementById("maxGuests").textContent = String(match.max_guests);

  const guestCount = document.getElementById("guestCount");
  guestCount.min = "1";
  guestCount.max = String(match.max_guests);
  guestCount.value = "1";

  setText("guestHint", `You can RSVP for up to ${match.max_guests} guest(s) including you.`);
  document.getElementById("matchBox").classList.remove("hidden");
}

function clampGuestCount(opts = {}) {
  // Keep guest count between 1 and the current guest's max
  // allowEmpty=true lets the user clear the field while typing
  const allowEmpty = opts.allowEmpty === true;
  if (!currentMatch) return;

  const input = document.getElementById("guestCount");
  const raw = input.value;

  if (allowEmpty && raw.trim() === "") {
    return;
  }

  const max = Number(currentMatch.max_guests);
  let val = Number(raw);

  if (!Number.isFinite(val) || val < 1) val = 1;
  if (val > max) val = max;

  input.value = String(val);
}

async function submitRSVP() {
  if (!currentMatch) return;

  const attending = document.querySelector('input[name="attending"]:checked')?.value || "yes";

  const maxGuests = Number(currentMatch.max_guests);
  const guestCountVal = Number(document.getElementById("guestCount").value);

  // If not attending, guest count will be 0
  const guestCount = (attending === "yes") ? guestCountVal : 0;

  if (attending === "yes") {
    if (!Number.isFinite(guestCount) || guestCount < 1 || guestCount > maxGuests) {
      setText("submitStatus", `Guest count must be between 1 and ${maxGuests}.`);
      return;
    }
  }

  const notes = document.getElementById("notes").value.trim();

  const payload = {
    name: currentMatch.name,
    attending,
    guestCount,
    notes
  };

  setText("submitStatus", "Submitting...");

  try {
    await fetch(GOOGLE_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload),
    });

    setText("submitStatus", "✅ RSVP submitted. Thank you!");
  } catch (e) {
    console.error(e);
    setText("submitStatus", "❌ Submit failed. Please try again.");
  }
}

async function main() {
  setText("status", "Loading guest list...");
  await loadGuests();
  setText("status", "");

  document.getElementById("searchBtn").addEventListener("click", () => {
    const q = document.getElementById("nameInput").value;
    if (!q.trim()) {
      setText("status", "Please enter your name.");
      return;
    }
    const wordCount = norm(q).split(" ").filter(Boolean).length;
    if (wordCount < 2) {
      setText("status", "Please enter your full name (first and last).");
      document.getElementById("matchBox").classList.add("hidden");
      currentMatch = null;
      return;
    }

    const { best, bestScore } = findBestMatch(q);

    // Threshold prevents nonsense matches
    if (!best || bestScore < 0.2) {
      setText("status", "No close match found. Please try your full name.");
      document.getElementById("matchBox").classList.add("hidden");
      currentMatch = null;
      return;
    }

    setText("status", "");
    showMatch(best);
  });

  const guestCountInput = document.getElementById("guestCount");
  guestCountInput.addEventListener("input", () => clampGuestCount({ allowEmpty: true }));
  guestCountInput.addEventListener("change", clampGuestCount);

  document.getElementById("submitBtn").addEventListener("click", submitRSVP);
}

window.addEventListener("DOMContentLoaded", main);
