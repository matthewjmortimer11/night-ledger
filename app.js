(() => {
  "use strict";

  const STORAGE_KEY = "night-ledger-state-v1";
  const ACTIVE_GROUP_KEY = "night-ledger-active-group-v1";
  const STATE_VERSION = 1;
  const PERSON_COLORS = ["#167d78", "#d85c55", "#4d5aa4", "#b77818", "#287d50", "#9b4e86", "#3577a5", "#7b624c"];
  const DRINK_PRESETS = {
    pint: { name: "Pint", type: "beer", units: 2.3, cost: 6.4 },
    guinness: { name: "Guinness", type: "guinness", units: 2.3, cost: 6.6 },
    wine: { name: "Glass of wine", type: "wine", units: 2.1, cost: 7.5 },
    single: { name: "Single and mixer", type: "spirit", units: 1, cost: 7.2 },
    cocktail: { name: "Cocktail", type: "cocktail", units: 2, cost: 11.5 },
    soft: { name: "Alcohol-free drink", type: "soft", units: 0, cost: 4.2 },
    water: { name: "Water", type: "water", units: 0, cost: 0 }
  };
  const DEFAULT_BINGO = [
    ["Photo with the pub sign", 3],
    ["A song everyone knows", 2],
    ["Someone tries a new drink", 2],
    ["Find the best pub dog", 3],
    ["A perfectly timed group photo", 4],
    ["Spot matching outfits", 2],
    ["A stranger recommends the next stop", 4],
    ["Order a local drink", 3],
    ["Hear a truly terrible joke", 2],
    ["Find an unusual coaster", 2],
    ["Someone gets the round exactly right", 3],
    ["Everyone drinks some water", 4]
  ];

  const ui = {
    activeView: "replay",
    scoreTab: "scores",
    drinkPerson: "all",
    drinkVenue: "all",
    timelineType: "all"
  };

  const account = {
    user: null,
    groups: [],
    activeGroupId: localStorage.getItem(ACTIVE_GROUP_KEY) || "",
    syncTimer: null,
    syncing: false
  };

  let state = loadState();
  let dialogSubmitHandler = null;

  const dom = {
    root: document.getElementById("view-root"),
    title: document.getElementById("night-title"),
    date: document.getElementById("night-date"),
    location: document.getElementById("night-location"),
    status: document.getElementById("night-status"),
    select: document.getElementById("night-select"),
    dialog: document.getElementById("app-dialog"),
    dialogForm: document.getElementById("dialog-shell"),
    dialogEyebrow: document.getElementById("dialog-eyebrow"),
    dialogTitle: document.getElementById("dialog-title"),
    dialogBody: document.getElementById("dialog-body"),
    dialogFooter: document.getElementById("dialog-footer"),
    toastRegion: document.getElementById("toast-region"),
    importFile: document.getElementById("import-file"),
    mobileFab: document.getElementById("mobile-fab"),
    accountButton: document.getElementById("account-button"),
    accountLabel: document.getElementById("account-label")
  };

  function uid(prefix = "id") {
    if (window.crypto && crypto.randomUUID) return prefix + "-" + crypto.randomUUID();
    return prefix + "-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 9);
  }

  function localDate(date = new Date()) {
    const offset = date.getTimezoneOffset();
    return new Date(date.getTime() - offset * 60000).toISOString().slice(0, 10);
  }

  function dateOffset(days) {
    const date = new Date();
    date.setDate(date.getDate() + days);
    return localDate(date);
  }

  function createBingoItems() {
    return DEFAULT_BINGO.map(([title, points]) => ({
      id: uid("bingo"),
      title,
      points,
      completedBy: null,
      completedAt: null,
      proofNote: "",
      proofPhoto: ""
    }));
  }

  function createSampleGSplits(date) {
    return [
      { id: "g-1", personId: "person-alex", venue: "The Lantern", score: 8.6, note: "Clean pass through the lower curve.", photo: "", timestamp: date + "T19:18" },
      { id: "g-2", personId: "person-maya", venue: "Fox & Fir", score: 9.2, note: "A near-perfect split with the room watching.", photo: "assets/night-board.png", timestamp: date + "T20:36" },
      { id: "g-3", personId: "person-sam", venue: "Fox & Fir", score: 7.8, note: "Slightly high, still tidy.", photo: "", timestamp: date + "T20:38" },
      { id: "g-4", personId: "person-maya", venue: "Vinyl Room", score: 8.9, note: "Consistent form.", photo: "", timestamp: date + "T21:55" },
      { id: "g-5", personId: "person-jordan", venue: "Vinyl Room", score: 8.4, note: "First proper attempt of the night.", photo: "", timestamp: date + "T21:57" }
    ];
  }

  function createBlankNight({ title, date, location, budget, participants }) {
    return {
      id: uid("night"),
      title: title || "New night out",
      date: date || localDate(),
      status: "planned",
      location: location || "",
      budget: Number(budget) || 50,
      participants: (participants || []).map((person, index) => ({
        id: uid("person"),
        name: typeof person === "string" ? person : person.name,
        color: typeof person === "string" ? PERSON_COLORS[index % PERSON_COLORS.length] : person.color
      })),
      scoreRules: {
        drinkPoint: 1,
        drinkCap: 5,
        venuePoint: 2,
        waterPoint: 2,
        bingoMultiplier: 1,
        momentPoint: 2
      },
      drinks: [],
      gSplits: [],
      moments: [],
      bingo: createBingoItems(),
      stops: [],
      bonuses: [],
      expenses: []
    };
  }

  function createSeedState() {
    const date = localDate();
    const people = [
      { id: "person-alex", name: "Alex", color: "#167d78" },
      { id: "person-maya", name: "Maya", color: "#d85c55" },
      { id: "person-sam", name: "Sam", color: "#4d5aa4" },
      { id: "person-jordan", name: "Jordan", color: "#b77818" }
    ];
    const bingo = createBingoItems();
    const completeBingo = (index, personId, time, note, photo = "") => {
      Object.assign(bingo[index], {
        completedBy: personId,
        completedAt: date + "T" + time,
        proofNote: note,
        proofPhoto: photo
      });
    };
    completeBingo(0, "person-maya", "19:24", "Got it outside The Lantern before round one.", "assets/night-board.png");
    completeBingo(1, "person-sam", "20:48", "The whole room joined the chorus.");
    completeBingo(4, "person-alex", "21:35", "First attempt. Nobody blinked.");
    completeBingo(8, "person-jordan", "22:06", "Sam's joke was ruled bad enough by unanimous vote.");
    completeBingo(11, "person-maya", "22:32", "Four waters on the table. Evidence witnessed by everyone.");

    const currentNight = {
      id: "night-saturday",
      title: "The Saturday Circuit",
      date,
      status: "live",
      location: "Northern Quarter, Manchester",
      budget: 60,
      participants: people,
      scoreRules: {
        drinkPoint: 1,
        drinkCap: 5,
        venuePoint: 2,
        waterPoint: 2,
        bingoMultiplier: 1,
        momentPoint: 2
      },
      stops: [
        { id: "stop-lantern", name: "The Lantern", address: "Oldham Street", time: "19:00", aim: "First round", notes: "Meet by the front window", visited: true, visitedAt: date + "T19:05" },
        { id: "stop-fox", name: "Fox & Fir", address: "Swan Street", time: "20:15", aim: "Bingo stop", notes: "Try the local tap", visited: true, visitedAt: date + "T20:21" },
        { id: "stop-vinyl", name: "Vinyl Room", address: "Tib Street", time: "21:30", aim: "Music and photos", notes: "Table held until 21:45", visited: true, visitedAt: date + "T21:38" },
        { id: "stop-nightjar", name: "The Nightjar", address: "Stevenson Square", time: "23:00", aim: "Final stop", notes: "Last entry around midnight", visited: false, visitedAt: null }
      ],
      drinks: [
        { id: "drink-1", personId: "person-alex", payerId: "person-alex", name: "House lager", type: "beer", units: 2.3, cost: 6.2, venue: "The Lantern", timestamp: date + "T19:12" },
        { id: "drink-2", personId: "person-maya", payerId: "person-alex", name: "Dry cider", type: "beer", units: 2.1, cost: 6.6, venue: "The Lantern", timestamp: date + "T19:13" },
        { id: "drink-3", personId: "person-sam", payerId: "person-alex", name: "Pale ale", type: "beer", units: 2.4, cost: 6.5, venue: "The Lantern", timestamp: date + "T19:14" },
        { id: "drink-4", personId: "person-jordan", payerId: "person-alex", name: "Alcohol-free lager", type: "soft", units: 0, cost: 4.4, venue: "The Lantern", timestamp: date + "T19:14" },
        { id: "drink-5", personId: "person-alex", payerId: "person-maya", name: "Local IPA", type: "beer", units: 2.7, cost: 6.9, venue: "Fox & Fir", timestamp: date + "T20:28" },
        { id: "drink-6", personId: "person-maya", payerId: "person-maya", name: "Sauvignon blanc", type: "wine", units: 2.1, cost: 7.8, venue: "Fox & Fir", timestamp: date + "T20:29" },
        { id: "drink-7", personId: "person-sam", payerId: "person-maya", name: "Ginger highball", type: "cocktail", units: 1.8, cost: 10.5, venue: "Fox & Fir", timestamp: date + "T20:30" },
        { id: "drink-8", personId: "person-jordan", payerId: "person-maya", name: "Tonic and lime", type: "soft", units: 0, cost: 3.8, venue: "Fox & Fir", timestamp: date + "T20:30" },
        { id: "drink-9", personId: "person-alex", payerId: "person-sam", name: "Water", type: "water", units: 0, cost: 0, venue: "Vinyl Room", timestamp: date + "T21:48" },
        { id: "drink-10", personId: "person-maya", payerId: "person-sam", name: "Water", type: "water", units: 0, cost: 0, venue: "Vinyl Room", timestamp: date + "T21:48" },
        { id: "drink-11", personId: "person-sam", payerId: "person-sam", name: "Espresso martini", type: "cocktail", units: 1.9, cost: 11.8, venue: "Vinyl Room", timestamp: date + "T21:51" },
        { id: "drink-12", personId: "person-jordan", payerId: "person-sam", name: "Alcohol-free spritz", type: "soft", units: 0, cost: 7.2, venue: "Vinyl Room", timestamp: date + "T21:51" }
      ],
      gSplits: createSampleGSplits(date),
      moments: [
        { id: "moment-1", personId: "person-maya", title: "The starting line", note: "Everyone arrived within five minutes. A historic first.", photo: "assets/night-board.png", points: 2, timestamp: date + "T19:03" },
        { id: "moment-2", personId: "person-sam", title: "Accidental pub choir", note: "The chorus landed and the entire back table joined in.", photo: "", points: 3, timestamp: date + "T20:49" },
        { id: "moment-3", personId: "person-alex", title: "One-take group photo", note: "Good light, open eyes, no retakes. Suspiciously efficient.", photo: "", points: 2, timestamp: date + "T21:36" }
      ],
      bonuses: [
        { id: "bonus-1", personId: "person-jordan", description: "Found the quiet table", points: 3, timestamp: date + "T20:18" },
        { id: "bonus-2", personId: "person-maya", description: "Round recall under pressure", points: 2, timestamp: date + "T20:27" }
      ],
      expenses: [
        { id: "expense-1", description: "Taxi into town", cost: 18.4, payerId: "person-jordan", splitAmongIds: people.map((person) => person.id), timestamp: date + "T18:42" },
        { id: "expense-2", description: "Late chips", cost: 12, payerId: "person-sam", splitAmongIds: ["person-alex", "person-maya", "person-sam"], timestamp: date + "T22:18" }
      ],
      bingo
    };

    const planned = createBlankNight({
      title: "Bank Holiday Run",
      date: dateOffset(28),
      location: "Ancoats, Manchester",
      budget: 55,
      participants: people
    });
    planned.id = "night-bank-holiday";
    planned.stops = [
      { id: uid("stop"), name: "Cotton House", address: "Radium Street", time: "18:30", aim: "Food first", notes: "Booking for four", visited: false, visitedAt: null },
      { id: uid("stop"), name: "Canal Tap", address: "Redhill Street", time: "20:15", aim: "First bingo round", notes: "", visited: false, visitedAt: null },
      { id: uid("stop"), name: "The Workshop", address: "Blossom Street", time: "22:00", aim: "Music", notes: "", visited: false, visitedAt: null }
    ];

    return {
      version: STATE_VERSION,
      activeNightId: currentNight.id,
      nights: [currentNight, planned]
    };
  }

  function createStarterState() {
    const firstNight = createBlankNight({
      title: "Your night out",
      date: localDate(),
      location: "",
      budget: 50,
      participants: []
    });
    return {
      version: STATE_VERSION,
      activeNightId: firstNight.id,
      nights: [firstNight]
    };
  }

  function normaliseNight(night) {
    const blank = createBlankNight({});
    return {
      ...blank,
      ...night,
      participants: Array.isArray(night.participants) ? night.participants : [],
      scoreRules: { ...blank.scoreRules, ...(night.scoreRules || {}) },
      drinks: Array.isArray(night.drinks) ? night.drinks : [],
      gSplits: Array.isArray(night.gSplits)
        ? night.gSplits
        : night.id === "night-saturday" && night.title === "The Saturday Circuit"
          ? createSampleGSplits(night.date)
          : [],
      moments: Array.isArray(night.moments) ? night.moments : [],
      bingo: Array.isArray(night.bingo) ? night.bingo : createBingoItems(),
      stops: Array.isArray(night.stops) ? night.stops : [],
      bonuses: Array.isArray(night.bonuses) ? night.bonuses : [],
      expenses: Array.isArray(night.expenses) ? night.expenses : []
    };
  }

  function normaliseState(candidate) {
    if (!candidate || !Array.isArray(candidate.nights) || candidate.nights.length === 0) {
      return createStarterState();
    }
    const nights = candidate.nights.map(normaliseNight);
    const activeNightId = nights.some((night) => night.id === candidate.activeNightId)
      ? candidate.activeNightId
      : nights[0].id;
    return { version: STATE_VERSION, activeNightId, nights };
  }

  function loadState() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved ? normaliseState(JSON.parse(saved)) : createStarterState();
    } catch (error) {
      console.warn("Night Ledger could not load saved data.", error);
      return createStarterState();
    }
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      return true;
    } catch (error) {
      console.error("Night Ledger could not save data.", error);
      toast("This device is out of storage. Remove a few photos or export a backup.", "error");
      return false;
    }
  }

  async function api(path, options = {}) {
    const response = await fetch(path, {
      ...options,
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(options.headers || {})
      },
      credentials: "same-origin"
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "That request could not be completed.");
    return payload;
  }

  function getActiveGroup() {
    return account.groups.find((group) => group.id === account.activeGroupId) || null;
  }

  async function refreshAccount() {
    try {
      const session = await api("/api/session");
      account.user = session.user;
      account.groups = [];
      if (account.user) {
        const groups = await api("/api/groups");
        account.groups = groups.groups || [];
        if (!getActiveGroup()) {
          account.activeGroupId = "";
          localStorage.removeItem(ACTIVE_GROUP_KEY);
        }
      } else {
        account.activeGroupId = "";
        localStorage.removeItem(ACTIVE_GROUP_KEY);
      }
    } catch {
      account.user = null;
      account.groups = [];
      account.activeGroupId = "";
    }
  }

  function queueGroupSync() {
    if (!account.user || !getActiveGroup()) return;
    window.clearTimeout(account.syncTimer);
    account.syncTimer = window.setTimeout(async () => {
      if (account.syncing) return;
      account.syncing = true;
      try {
        await api("/api/groups/" + encodeURIComponent(account.activeGroupId) + "/ledger", {
          method: "PUT",
          body: JSON.stringify({ ledger: state })
        });
      } catch (error) {
        toast("Group sync failed: " + error.message, "error");
      } finally {
        account.syncing = false;
      }
    }, 500);
  }

  async function setActiveGroup(groupId, suppliedLedger = null, silent = false) {
    const group = account.groups.find((entry) => entry.id === groupId);
    if (!group) throw new Error("That group is not available to this account.");
    const payload = suppliedLedger ? { ledger: suppliedLedger } : await api("/api/groups/" + encodeURIComponent(groupId) + "/ledger");
    state = normaliseState(payload.ledger);
    account.activeGroupId = groupId;
    localStorage.setItem(ACTIVE_GROUP_KEY, groupId);
    saveState();
    render();
    if (!silent) toast("Now working in " + group.name + ".");
  }

  function addCurrentUserToActiveNight() {
    const night = getNight();
    const displayName = account.user?.displayName || "";
    if (!night || !displayName) return false;
    const alreadyAdded = night.participants.some((person) => person.name.trim().toLocaleLowerCase() === displayName.trim().toLocaleLowerCase());
    if (alreadyAdded) return false;
    night.participants.push({
      id: uid("person"),
      name: displayName,
      color: PERSON_COLORS[night.participants.length % PERSON_COLORS.length]
    });
    return true;
  }

  function getNight() {
    return state.nights.find((night) => night.id === state.activeNightId) || state.nights[0];
  }

  function getPerson(personId, night = getNight()) {
    return night.participants.find((person) => person.id === personId) || null;
  }

  function esc(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function safeImageSrc(value) {
    const source = String(value || "");
    if (source.startsWith("data:image/") || source === "assets/night-board.png") return esc(source);
    return "";
  }

  function icon(name, className = "") {
    return `<svg class="${className}" aria-hidden="true"><use href="#icon-${name}"></use></svg>`;
  }

  function initials(name) {
    return String(name || "?")
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0] || "")
      .join("")
      .toUpperCase();
  }

  function avatar(person, size = "") {
    if (!person) return "";
    return `<span class="avatar ${size ? "avatar-" + size : ""}" style="--avatar:${esc(person.color)}" aria-hidden="true">${esc(initials(person.name))}</span>`;
  }

  function formatMoney(value) {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency: "GBP",
      minimumFractionDigits: 2
    }).format(Number(value) || 0);
  }

  function formatDate(value, options = { weekday: "long", day: "numeric", month: "long" }) {
    if (!value) return "";
    const date = new Date(value + (String(value).length === 10 ? "T12:00:00" : ""));
    if (Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat("en-GB", options).format(date);
  }

  function formatTime(timestamp) {
    if (!timestamp) return "";
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return String(timestamp).slice(-5);
    return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" }).format(date);
  }

  function eventTimestamp(night, time) {
    return night.date + "T" + (time || new Date().toTimeString().slice(0, 5));
  }

  function currentTimeForNight(night) {
    if (night.date === localDate()) return new Date().toTimeString().slice(0, 5);
    return "20:00";
  }

  function unique(values) {
    return [...new Set(values.filter(Boolean))];
  }

  function sum(values) {
    return values.reduce((total, value) => total + (Number(value) || 0), 0);
  }

  function plural(value, singular, pluralForm = singular + "s") {
    return Number(value) === 1 ? singular : pluralForm;
  }

  function participantOptions(night, selectedId = "") {
    return night.participants
      .map((person) => `<option value="${esc(person.id)}" ${person.id === selectedId ? "selected" : ""}>${esc(person.name)}</option>`)
      .join("");
  }

  function venueOptions(night) {
    return unique([
      ...night.stops.map((stop) => stop.name),
      ...night.drinks.map((drink) => drink.venue)
    ]);
  }

  function statusLabel(status) {
    return ({ planned: "Planned", live: "Live tonight", complete: "Complete" })[status] || "Planned";
  }

  function toast(message, type = "") {
    const node = document.createElement("div");
    node.className = "toast" + (type ? " " + type : "");
    node.textContent = message;
    dom.toastRegion.appendChild(node);
    window.setTimeout(() => node.remove(), 3400);
  }

  function commit(message) {
    const saved = saveState();
    render();
    if (saved) queueGroupSync();
    if (message && saved) toast(message);
    return saved;
  }

  function emptyState(iconName, title, copy, action = "") {
    return `
      <div class="empty-state">
        <div class="empty-icon">${icon(iconName)}</div>
        <h3>${esc(title)}</h3>
        <p>${esc(copy)}</p>
        ${action}
      </div>
    `;
  }

  function calculateScores(night) {
    return night.participants
      .map((person) => {
        const splits = night.gSplits.filter((split) => split.personId === person.id);
        const best = splits.length ? Math.max(...splits.map((split) => Number(split.score) || 0)) : 0;
        const average = splits.length ? sum(splits.map((split) => split.score)) / splits.length : 0;
        const proofCount = splits.filter((split) => split.photo || split.note).length;
        return {
          person,
          splits,
          total: Math.round(average * 10) / 10,
          best: Math.round(best * 10) / 10,
          proofCount,
          breakdown: {
            attempts: splits.length,
            best: Math.round(best * 10) / 10,
            average: Math.round(average * 10) / 10,
            proof: proofCount
          }
        };
      })
      .sort((a, b) => b.total - a.total || b.best - a.best || a.person.name.localeCompare(b.person.name));
  }

  function calculateMoney(night) {
    const rows = night.participants.map((person) => ({
      person,
      paid: 0,
      owed: 0,
      net: 0
    }));
    const byId = new Map(rows.map((row) => [row.person.id, row]));

    night.drinks.forEach((drink) => {
      const cost = Number(drink.cost) || 0;
      if (byId.has(drink.payerId)) byId.get(drink.payerId).paid += cost;
      if (byId.has(drink.personId)) byId.get(drink.personId).owed += cost;
    });

    night.expenses.forEach((expense) => {
      const cost = Number(expense.cost) || 0;
      if (byId.has(expense.payerId)) byId.get(expense.payerId).paid += cost;
      const included = (expense.splitAmongIds || []).filter((id) => byId.has(id));
      if (included.length) {
        const share = cost / included.length;
        included.forEach((id) => {
          byId.get(id).owed += share;
        });
      }
    });

    rows.forEach((row) => {
      row.net = row.paid - row.owed;
    });

    const creditors = rows
      .filter((row) => row.net > 0.005)
      .map((row) => ({ ...row, remaining: row.net }))
      .sort((a, b) => b.remaining - a.remaining);
    const debtors = rows
      .filter((row) => row.net < -0.005)
      .map((row) => ({ ...row, remaining: -row.net }))
      .sort((a, b) => b.remaining - a.remaining);
    const settlements = [];
    let creditorIndex = 0;
    let debtorIndex = 0;
    while (creditorIndex < creditors.length && debtorIndex < debtors.length) {
      const creditor = creditors[creditorIndex];
      const debtor = debtors[debtorIndex];
      const amount = Math.min(creditor.remaining, debtor.remaining);
      if (amount > 0.005) {
        settlements.push({ from: debtor.person, to: creditor.person, amount });
      }
      creditor.remaining -= amount;
      debtor.remaining -= amount;
      if (creditor.remaining < 0.005) creditorIndex += 1;
      if (debtor.remaining < 0.005) debtorIndex += 1;
    }

    return {
      rows,
      settlements,
      total: sum(night.drinks.map((drink) => drink.cost)) + sum(night.expenses.map((expense) => expense.cost))
    };
  }

  function timelineEvents(night) {
    const drinks = night.drinks.map((drink) => {
      const person = getPerson(drink.personId, night);
      return {
        type: "drink",
        sourceId: drink.id,
        timestamp: drink.timestamp,
        person,
        title: drink.name,
        note: [drink.venue, Number(drink.units) > 0 ? Number(drink.units).toFixed(1) + " units" : "Alcohol-free"].filter(Boolean).join(" · "),
        photo: "",
        icon: drink.type === "water" ? "water" : "drink"
      };
    });
    const moments = night.moments.map((moment) => ({
      type: "memory",
      sourceId: moment.id,
      timestamp: moment.timestamp,
      person: getPerson(moment.personId, night),
      title: moment.title,
      note: moment.note,
      photo: moment.photo,
      icon: "camera"
    }));
    const gSplits = night.gSplits.map((split) => ({
      type: "gsplit",
      sourceId: split.id,
      timestamp: split.timestamp,
      person: getPerson(split.personId, night),
      title: "Split the G: " + Number(split.score).toFixed(1) + "/10",
      note: [split.venue, split.note].filter(Boolean).join(" · "),
      photo: split.photo,
      icon: "trophy"
    }));
    const bingo = night.bingo
      .filter((item) => item.completedAt)
      .map((item) => ({
        type: "bingo",
        sourceId: item.id,
        timestamp: item.completedAt,
        person: getPerson(item.completedBy, night),
        title: "Bingo: " + item.title,
        note: item.proofNote,
        photo: item.proofPhoto,
        icon: "grid"
      }));
    const stops = night.stops
      .filter((stop) => stop.visitedAt)
      .map((stop) => ({
        type: "stop",
        sourceId: stop.id,
        timestamp: stop.visitedAt,
        person: null,
        title: "Arrived at " + stop.name,
        note: stop.aim || stop.address,
        photo: "",
        icon: "pin"
      }));
    return [...drinks, ...gSplits, ...moments, ...bingo, ...stops].sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)));
  }

  function renderHeader() {
    const night = getNight();
    const group = getActiveGroup();
    dom.title.textContent = night.title;
    dom.date.textContent = formatDate(night.date);
    dom.location.textContent = night.location || "";
    dom.status.textContent = statusLabel(night.status);
    dom.status.dataset.status = night.status;
    dom.select.innerHTML = state.nights
      .slice()
      .sort((a, b) => String(b.date).localeCompare(String(a.date)))
      .map((item) => `<option value="${esc(item.id)}" ${item.id === night.id ? "selected" : ""}>${esc(item.title)}</option>`)
      .join("");
    dom.accountLabel.textContent = account.user ? (group ? group.name : account.user.displayName) : "Sign in";
    dom.accountButton.title = account.user ? "Account and groups" : "Sign in or create an account";
  }

  function renderNav() {
    document.querySelectorAll(".nav-tab").forEach((tab) => {
      const active = tab.dataset.view === ui.activeView;
      tab.classList.toggle("active", active);
      tab.setAttribute("aria-current", active ? "page" : "false");
    });
    const labels = {
      replay: "Add memory",
      scores: ui.scoreTab === "split" ? "Add expense" : "Add bonus",
      drinks: "Add drink",
      bingo: "Add bingo proof",
      plan: "Add stop"
    };
    dom.mobileFab.setAttribute("aria-label", labels[ui.activeView]);
    dom.mobileFab.title = labels[ui.activeView];
  }

  function metricCard(iconName, label, value, note) {
    return `
      <div class="metric">
        <div class="metric-topline">
          <span>${esc(label)}</span>
          <span class="metric-icon">${icon(iconName)}</span>
        </div>
        <div class="metric-value">${esc(value)}</div>
        <div class="metric-note">${esc(note)}</div>
      </div>
    `;
  }

  function renderMemoryStrip(night) {
    const moments = night.moments.slice().sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp))).slice(0, 3);
    if (!moments.length) return "";
    return `
      <div class="memory-strip" aria-label="Featured memories">
        ${moments.map((moment, index) => {
          const person = getPerson(moment.personId, night);
          const image = safeImageSrc(moment.photo);
          const style = image ? `background-image:linear-gradient(0deg, rgba(10,14,15,.88), rgba(10,14,15,.08) 70%),url('${image}')` : "";
          return `
            <button class="memory-tile" type="button" data-action="view-memory" data-id="${esc(moment.id)}" style="${style}">
              <span class="memory-tile-copy">
                <strong>${esc(moment.title)}</strong>
                <span>${esc(person ? person.name : "The group")} · ${formatTime(moment.timestamp)}</span>
              </span>
            </button>
          `;
        }).join("")}
      </div>
    `;
  }

  function renderLeaderList(night, limit = 4) {
    const scores = calculateScores(night);
    if (!scores.length) return emptyState("users", "No guests yet", "Add people to start the Guinness split board.");
    const max = Math.max(...scores.map((score) => score.total), 1);
    return `
      <div class="leader-list">
        ${scores.slice(0, limit).map((score, index) => `
          <div class="leader-row">
            <span class="rank ${index === 0 ? "rank-first" : ""}">${index + 1}</span>
            ${avatar(score.person)}
            <div class="leader-name">
              <strong>${esc(score.person.name)}</strong>
              <div class="score-track"><span style="--progress:${Math.round(score.total / max * 100)}%;--bar:${esc(score.person.color)}"></span></div>
            </div>
            <span class="leader-score">${score.total.toFixed(1)}</span>
          </div>
        `).join("")}
      </div>
    `;
  }

  function renderSettlementList(night, limit = 3) {
    const money = calculateMoney(night);
    if (!money.settlements.length) {
      return `<div class="balanced">${icon("check")}<strong>All square</strong></div>`;
    }
    return `
      <div class="settlement-list">
        ${money.settlements.slice(0, limit).map((item) => `
          <div class="settlement-line">
            <div class="avatar-stack">${avatar(item.from, "small")}${avatar(item.to, "small")}</div>
            <div class="settlement-flow"><strong>${esc(item.from.name)}</strong> pays <strong>${esc(item.to.name)}</strong></div>
            <div class="settlement-amount">${formatMoney(item.amount)}</div>
          </div>
        `).join("")}
      </div>
    `;
  }

  function renderTimeline(night) {
    const events = timelineEvents(night).filter((event) => ui.timelineType === "all" || event.type === ui.timelineType);
    if (!events.length) {
      return emptyState("replay", "Nothing logged yet", "The first drink, check-in, bingo claim, or memory will appear here.",
        `<div class="empty-actions"><button class="button button-primary" type="button" data-action="add-memory">${icon("camera")}Add memory</button></div>`);
    }
    return `
      <div class="timeline">
        ${events.map((event) => {
          const image = safeImageSrc(event.photo);
          return `
            <article class="timeline-item">
              <div class="timeline-dot" data-type="${event.type}">${icon(event.icon)}</div>
              <div class="timeline-content">
                <h4>${esc(event.title)}</h4>
                ${event.note ? `<p>${esc(event.note)}</p>` : ""}
                ${image ? `<img class="timeline-photo" src="${image}" alt="">` : ""}
                <div class="timeline-meta">
                  <span>${formatTime(event.timestamp)}</span>
                  ${event.person ? `<span class="timeline-person">${avatar(event.person, "small")}${esc(event.person.name)}</span>` : ""}
                </div>
              </div>
              ${["drink", "memory", "gsplit"].includes(event.type) ? `
                <button class="icon-button icon-button-danger" type="button" data-action="delete-timeline-item" data-kind="${event.type}" data-id="${esc(event.sourceId)}" title="Delete" aria-label="Delete ${esc(event.title)}">
                  ${icon("trash")}
                </button>
              ` : `<span></span>`}
            </article>
          `;
        }).join("")}
      </div>
    `;
  }

  function renderReplay() {
    const night = getNight();
    const scores = calculateScores(night);
    const totalUnits = sum(night.drinks.map((drink) => drink.units));
    const completed = night.bingo.filter((item) => item.completedAt).length;
    const money = calculateMoney(night);
    const visited = night.stops.filter((stop) => stop.visited).length;
    const budgetTotal = Number(night.budget || 0) * Math.max(night.participants.length, 1);
    const budgetProgress = budgetTotal ? Math.min(100, Math.round(money.total / budgetTotal * 100)) : 0;
    const bingoProgress = night.bingo.length ? Math.round(completed / night.bingo.length * 100) : 0;
    const routeProgress = night.stops.length ? Math.round(visited / night.stops.length * 100) : 0;

    dom.root.innerHTML = `
      <div class="view-heading">
        <div>
          <p class="eyebrow">Night replay</p>
          <h2>How the night unfolded</h2>
          <p>Every round, win, stop, and story in one timeline.</p>
        </div>
        <div class="view-actions">
          <button class="button button-secondary" type="button" data-action="print-night">${icon("download")}<span>Print replay</span></button>
          <button class="button button-primary" type="button" data-action="add-memory">${icon("camera")}Add memory</button>
        </div>
      </div>

      <section class="metrics-grid" aria-label="Night summary">
        ${metricCard("drink", "Drinks logged", night.drinks.length, totalUnits.toFixed(1) + " total units")}
        ${metricCard("trophy", "Split the G leader", scores[0] ? scores[0].person.name : "No score", scores[0] && scores[0].total ? scores[0].total.toFixed(1) + " / 10 average" : "Score a Guinness")}
        ${metricCard("wallet", "Night spend", formatMoney(money.total), money.settlements.length + " " + plural(money.settlements.length, "settlement"))}
        ${metricCard("grid", "Bingo cleared", completed + "/" + night.bingo.length, bingoProgress + "% complete")}
      </section>

      ${renderMemoryStrip(night)}

      <div class="content-grid">
        <section class="panel">
          <header class="panel-heading">
            <div>
              <h3>Replay timeline</h3>
              <p>Latest first</p>
            </div>
            <div class="panel-heading-actions">
              <label class="sr-only" for="timeline-type">Filter timeline</label>
              <select class="compact-select" id="timeline-type">
                <option value="all" ${ui.timelineType === "all" ? "selected" : ""}>Everything</option>
                <option value="memory" ${ui.timelineType === "memory" ? "selected" : ""}>Memories</option>
                <option value="drink" ${ui.timelineType === "drink" ? "selected" : ""}>Drinks</option>
                <option value="gsplit" ${ui.timelineType === "gsplit" ? "selected" : ""}>Split the G</option>
                <option value="bingo" ${ui.timelineType === "bingo" ? "selected" : ""}>Bingo</option>
                <option value="stop" ${ui.timelineType === "stop" ? "selected" : ""}>Stops</option>
              </select>
            </div>
          </header>
          <div class="panel-body panel-body-flush">
            ${renderTimeline(night)}
          </div>
        </section>

        <aside class="side-stack">
          <section class="panel panel-accent">
            <header class="panel-heading">
              <div><h3>Split the G</h3><p>Current standings</p></div>
              <button class="text-button" type="button" data-view="scores">Scoreboard</button>
            </header>
            <div class="panel-body">${renderLeaderList(night)}</div>
          </section>

          <section class="panel">
            <header class="panel-heading">
              <div><h3>Settle up</h3><p>Smallest set of payments</p></div>
              <button class="text-button" type="button" data-action="open-split">See split</button>
            </header>
            <div class="panel-body">${renderSettlementList(night)}</div>
          </section>

          <section class="panel panel-teal">
            <header class="panel-heading"><div><h3>Night pulse</h3><p>Plan against reality</p></div></header>
            <div class="panel-body">
              <div class="progress-block">
                <div class="progress-label"><span>Route</span><strong>${visited}/${night.stops.length}</strong></div>
                <div class="progress-bar"><span style="--progress:${routeProgress}%"></span></div>
              </div>
              <div class="progress-block">
                <div class="progress-label"><span>Bingo</span><strong>${bingoProgress}%</strong></div>
                <div class="progress-bar"><span style="--progress:${bingoProgress}%"></span></div>
              </div>
              <div class="progress-block">
                <div class="progress-label"><span>Group budget</span><strong>${budgetProgress}%</strong></div>
                <div class="progress-bar progress-bar-amber"><span style="--progress:${budgetProgress}%"></span></div>
              </div>
            </div>
          </section>
        </aside>
      </div>
    `;
  }

  function breakdownChip(label, value) {
    return `<div class="breakdown-chip"><span>${esc(label)}</span><strong>${value}</strong></div>`;
  }

  function renderScores() {
    const night = getNight();
    const scores = calculateScores(night);
    const money = calculateMoney(night);
    const totalScore = 10;

    const scoreboard = scores.length
      ? `<div class="scoreboard">
          ${scores.map((row, index) => `
            <article class="score-card" style="--person-color:${esc(row.person.color)}">
              <div class="score-rank">${index + 1}</div>
              <div class="score-meta">
                ${avatar(row.person, "large")}
                <div>
                  <h3>${esc(row.person.name)}</h3>
                  <p>${row.breakdown.attempts} ${plural(row.breakdown.attempts, "attempt")} · best split ${row.best.toFixed(1)}/10</p>
                </div>
              </div>
              <div class="score-value"><strong>${row.total.toFixed(1)}</strong><span>/10 G score</span></div>
              <div class="score-breakdown">
                ${breakdownChip("Attempts", row.breakdown.attempts)}
                ${breakdownChip("Best split", row.breakdown.best.toFixed(1))}
                ${breakdownChip("Average", row.breakdown.average.toFixed(1))}
                ${breakdownChip("Proof", row.breakdown.proof)}
              </div>
              <div class="score-track" style="grid-column:2 / -1"><span style="--progress:${Math.round(row.total / totalScore * 100)}%;--bar:${esc(row.person.color)}"></span></div>
            </article>
          `).join("")}
        </div>`
      : emptyState("users", "Build the guest list", "Split-the-G scores appear once you add the people on the night.",
        `<div class="empty-actions"><button class="button button-primary" type="button" data-action="manage-people">${icon("users")}Manage guests</button></div>`);

    const gSplitPanel = night.gSplits.length
      ? `<div class="bonus-list">
          ${night.gSplits.slice().sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp))).map((split) => {
            const person = getPerson(split.personId, night);
            return `
              <div class="bonus-row">
                ${avatar(person, "small")}
                <div class="bonus-copy"><strong>${Number(split.score).toFixed(1)}/10 at ${esc(split.venue || "Unknown venue")}</strong><span>${esc(person ? person.name : "Guest")} · ${formatTime(split.timestamp)}</span></div>
                <div class="bonus-points">${Number(split.score).toFixed(1)}</div>
                <button class="icon-button icon-button-danger" type="button" data-action="delete-g-split" data-id="${esc(split.id)}" title="Delete G split" aria-label="Delete G split">${icon("trash")}</button>
              </div>
            `;
          }).join("")}
        </div>`
      : emptyState("trophy", "No splits scored yet", "Log the first Guinness split and put a number on it.");

    const scoreView = `
      <div class="content-grid">
        <section class="panel panel-teal">
          <header class="panel-heading">
            <div><h3>Split the G leaderboard</h3><p>Average score wins. Best split breaks a tie.</p></div>
            <button class="button button-small button-secondary" type="button" data-action="add-g-score">${icon("plus")}Score a split</button>
          </header>
          <div class="panel-body">${scoreboard}</div>
        </section>
        <aside class="side-stack">
          <section class="panel">
            <header class="panel-heading">
              <div><h3>How it ranks</h3><p>Simple, subjective, and public</p></div>
            </header>
            <div class="panel-body">
              <div class="formula-note"><strong>Each Guinness split gets a 0-10 score.</strong> The board ranks average quality first, then the best individual split.</div>
              <div class="setting-list" style="margin-top:10px">
                <div class="setting-row"><div class="setting-copy"><strong>Primary rank</strong><span>Average scored split</span></div><strong>/10</strong></div>
                <div class="setting-row"><div class="setting-copy"><strong>Tie break</strong><span>Best individual split</span></div><strong>/10</strong></div>
                <div class="setting-row"><div class="setting-copy"><strong>Evidence</strong><span>Photo or note is tracked</span></div><strong>Optional</strong></div>
              </div>
            </div>
          </section>
          <section class="panel panel-accent">
            <header class="panel-heading">
              <div><h3>Latest G splits</h3><p>Every scored Guinness in one place</p></div>
              <button class="button button-small button-secondary" type="button" data-action="add-g-score">${icon("plus")}Score</button>
            </header>
            <div class="panel-body">${gSplitPanel}</div>
          </section>
        </aside>
      </div>
    `;

    const splitView = `
      <section class="metrics-grid" aria-label="Split summary">
        ${metricCard("wallet", "Total spend", formatMoney(money.total), night.drinks.length + " drink logs + " + night.expenses.length + " shared costs")}
        ${metricCard("users", "Per person average", formatMoney(night.participants.length ? money.total / night.participants.length : 0), night.participants.length + " " + plural(night.participants.length, "guest"))}
        ${metricCard("route", "Payments needed", money.settlements.length, money.settlements.length ? "Smallest clean split" : "Everyone is square")}
        ${metricCard("calendar", "Budget left", formatMoney(Math.max(0, Number(night.budget || 0) * night.participants.length - money.total)), "Against the group budget")}
      </section>
      <div class="content-grid">
        <section class="panel panel-teal">
          <header class="panel-heading">
            <div><h3>Settle the night</h3><p>Only the payments needed to balance up</p></div>
            <button class="button button-small button-secondary" type="button" data-action="add-expense">${icon("plus")}Shared cost</button>
          </header>
          <div class="panel-body">
            ${money.settlements.length ? `<div class="settlement-list">
              ${money.settlements.map((item) => `
                <div class="settlement-line">
                  <div class="avatar-stack">${avatar(item.from, "small")}${avatar(item.to, "small")}</div>
                  <div class="settlement-flow"><strong>${esc(item.from.name)}</strong> pays <strong>${esc(item.to.name)}</strong></div>
                  <div class="settlement-amount">${formatMoney(item.amount)}</div>
                </div>
              `).join("")}
            </div>` : `<div class="balanced">${icon("check")}<strong>Everyone is square</strong><p>No payments needed.</p></div>`}
          </div>
        </section>
        <aside class="panel">
          <header class="panel-heading"><div><h3>Shared costs</h3><p>Split by the selected guests</p></div><button class="text-button" type="button" data-action="add-expense">Add cost</button></header>
          <div class="panel-body">
            ${night.expenses.length ? `<div class="expense-list">
              ${night.expenses.slice().sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp))).map((expense) => {
                const payer = getPerson(expense.payerId, night);
                return `<div class="expense-row">
                  ${avatar(payer, "small")}
                  <div class="expense-copy"><strong>${esc(expense.description)}</strong><span>Paid by ${esc(payer ? payer.name : "Unknown")} · ${expense.splitAmongIds.length} sharing</span></div>
                  <strong>${formatMoney(expense.cost)}</strong>
                  <button class="icon-button icon-button-danger" type="button" data-action="delete-expense" data-id="${esc(expense.id)}" title="Delete shared cost" aria-label="Delete shared cost">${icon("trash")}</button>
                </div>`;
              }).join("")}
            </div>` : emptyState("wallet", "No shared costs", "Add taxis, food, tickets, or anything everyone is splitting.")}
          </div>
        </aside>
      </div>
      <section class="panel" style="margin-top:18px">
        <header class="panel-heading"><div><h3>Who paid and who owes</h3><p>Drink costs belong to the drinker. Shared costs use their selected split.</p></div></header>
        <div class="panel-body panel-body-flush">
          <div style="overflow-x:auto">
            <table class="money-table">
              <thead><tr><th>Guest</th><th>Paid</th><th>Fair share</th><th>Net</th></tr></thead>
              <tbody>
                ${money.rows.map((row) => `<tr>
                  <td><span class="timeline-person">${avatar(row.person, "small")}${esc(row.person.name)}</span></td>
                  <td>${formatMoney(row.paid)}</td>
                  <td>${formatMoney(row.owed)}</td>
                  <td class="${row.net > 0.005 ? "money-positive" : row.net < -0.005 ? "money-negative" : ""}">${row.net > 0.005 ? "+" : ""}${formatMoney(row.net)}</td>
                </tr>`).join("")}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    `;

    dom.root.innerHTML = `
      <div class="view-heading">
        <div><p class="eyebrow">Guinness and spend</p><h2>Who split the G cleanest?</h2><p>Score the pour separately, then settle the actual spend.</p></div>
        <div class="view-actions">
          <div class="segmented-control" aria-label="Guinness score view">
            <button class="segment ${ui.scoreTab === "scores" ? "active" : ""}" type="button" data-score-tab="scores">Split the G</button>
            <button class="segment ${ui.scoreTab === "split" ? "active" : ""}" type="button" data-score-tab="split">Split spend</button>
          </div>
          <button class="button button-primary" type="button" data-action="${ui.scoreTab === "scores" ? "add-g-score" : "add-expense"}">${icon("plus")}${ui.scoreTab === "scores" ? "Score a split" : "Shared cost"}</button>
        </div>
      </div>
      ${ui.scoreTab === "scores" ? scoreView : splitView}
    `;
  }

  function drinkTypeIcon(type) {
    return type === "water" ? "water" : "drink";
  }

  function renderDrinks() {
    const night = getNight();
    const venues = venueOptions(night);
    const filtered = night.drinks.filter((drink) => {
      return (ui.drinkPerson === "all" || drink.personId === ui.drinkPerson)
        && (ui.drinkVenue === "all" || drink.venue === ui.drinkVenue);
    }).sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)));
    const alcoholic = night.drinks.filter((drink) => !["water", "soft"].includes(drink.type));
    const waterCount = night.drinks.filter((drink) => drink.type === "water").length;
    const totalCost = sum(night.drinks.map((drink) => drink.cost));
    const maxCount = Math.max(...night.participants.map((person) => night.drinks.filter((drink) => drink.personId === person.id).length), 1);

    const list = filtered.length
      ? `<div class="drink-list">
        ${filtered.map((drink) => {
          const person = getPerson(drink.personId, night);
          const payer = getPerson(drink.payerId, night);
          return `
            <article class="drink-row">
              <span class="type-icon" data-type="${esc(drink.type)}">${icon(drinkTypeIcon(drink.type))}</span>
              <div class="drink-main">${avatar(person, "small")}<div class="drink-copy"><strong>${esc(drink.name)}</strong><span>${esc(person ? person.name : "Guest")} · paid by ${esc(payer ? payer.name : "Guest")}</span></div></div>
              <span class="drink-venue">${esc(drink.venue || "No venue")}</span>
              <span class="drink-facts">${Number(drink.units) > 0 ? Number(drink.units).toFixed(1) + " units" : "0 units"}<span class="drink-time">· ${formatTime(drink.timestamp)}</span></span>
              <span class="drink-price">${formatMoney(drink.cost)}</span>
              <button class="icon-button icon-button-danger" type="button" data-action="delete-drink" data-id="${esc(drink.id)}" title="Delete drink" aria-label="Delete ${esc(drink.name)}">${icon("trash")}</button>
            </article>
          `;
        }).join("")}
      </div>`
      : emptyState("drink", "No matching logs", "Try another filter or add a round.",
        `<div class="empty-actions"><button class="button button-primary" type="button" data-action="add-drink">${icon("plus")}Add drink</button></div>`);

    dom.root.innerHTML = `
      <div class="view-heading">
        <div><p class="eyebrow">Round tracker</p><h2>The drinks ledger</h2><p>Log every round, including alcohol-free and water.</p></div>
        <div class="view-actions"><button class="button button-primary" type="button" data-action="add-drink">${icon("plus")}Add drink</button></div>
      </div>

      <section class="metrics-grid" aria-label="Drink summary">
        ${metricCard("drink", "Logged drinks", night.drinks.length, alcoholic.length + " alcohol logs")}
        ${metricCard("spark", "Alcohol units", sum(alcoholic.map((drink) => drink.units)).toFixed(1), "Across the whole group")}
        ${metricCard("water", "Waters", waterCount, "Logged alongside the rounds")}
        ${metricCard("wallet", "Drink spend", formatMoney(totalCost), "Excludes shared costs")}
      </section>

      <div class="content-grid">
        <section class="panel">
          <header class="panel-heading">
            <div><h3>Round history</h3><p>Most recent first</p></div>
            <div class="panel-heading-actions"><button class="button button-small button-secondary" type="button" data-action="add-drink">${icon("plus")}Log</button></div>
          </header>
          <div class="panel-body">
            <div class="quick-adds" aria-label="Quick add drinks">
              <button class="quick-add" type="button" data-action="quick-drink" data-preset="pint">Pint</button>
              <button class="quick-add" type="button" data-action="quick-drink" data-preset="guinness">Guinness</button>
              <button class="quick-add" type="button" data-action="quick-drink" data-preset="wine">Wine</button>
              <button class="quick-add" type="button" data-action="quick-drink" data-preset="single">Single</button>
              <button class="quick-add" type="button" data-action="quick-drink" data-preset="cocktail">Cocktail</button>
              <button class="quick-add" type="button" data-action="quick-drink" data-preset="soft">0% / soft</button>
              <button class="quick-add" type="button" data-action="quick-drink" data-preset="water">Water</button>
            </div>
            <div class="filter-row">
              <label class="sr-only" for="drink-person-filter">Filter by guest</label>
              <select id="drink-person-filter">
                <option value="all">All guests</option>
                ${night.participants.map((person) => `<option value="${esc(person.id)}" ${ui.drinkPerson === person.id ? "selected" : ""}>${esc(person.name)}</option>`).join("")}
              </select>
              <label class="sr-only" for="drink-venue-filter">Filter by venue</label>
              <select id="drink-venue-filter">
                <option value="all">All venues</option>
                ${venues.map((venue) => `<option value="${esc(venue)}" ${ui.drinkVenue === venue ? "selected" : ""}>${esc(venue)}</option>`).join("")}
              </select>
            </div>
          </div>
          <div class="panel-body panel-body-flush">${list}</div>
        </section>

        <aside class="side-stack">
          <section class="panel panel-teal">
            <header class="panel-heading"><div><h3>Logged by guest</h3><p>All drink types</p></div></header>
            <div class="panel-body">
              <div class="drink-chart">
                ${night.participants.map((person) => {
                  const count = night.drinks.filter((drink) => drink.personId === person.id).length;
                  return `<div class="chart-row"><span class="chart-name">${esc(person.name)}</span><div class="chart-track"><span style="--progress:${Math.round(count / maxCount * 100)}%;--bar:${esc(person.color)}"></span></div><span class="chart-value">${count} logs</span></div>`;
                }).join("")}
              </div>
            </div>
          </section>
          <section class="panel panel-accent">
            <header class="panel-heading"><div><h3>Quick context</h3><p>Useful when sorting the split later</p></div></header>
            <div class="panel-body">
              <div class="setting-list">
                <div class="setting-row"><div class="setting-copy"><strong>Distinct venues</strong><span>From drink logs</span></div><strong>${venues.length}</strong></div>
                <div class="setting-row"><div class="setting-copy"><strong>Average cost</strong><span>Per logged drink</span></div><strong>${formatMoney(night.drinks.length ? totalCost / night.drinks.length : 0)}</strong></div>
                <div class="setting-row"><div class="setting-copy"><strong>Most recent</strong><span>Latest log</span></div><strong>${night.drinks[0] ? formatTime(night.drinks.slice().sort((a,b) => String(b.timestamp).localeCompare(String(a.timestamp)))[0].timestamp) : "None"}</strong></div>
              </div>
            </div>
          </section>
        </aside>
      </div>
    `;
  }

  function renderBingo() {
    const night = getNight();
    const complete = night.bingo.filter((item) => item.completedAt).length;
    const points = sum(night.bingo.filter((item) => item.completedAt).map((item) => item.points));
    const progress = night.bingo.length ? Math.round(complete / night.bingo.length * 100) : 0;

    dom.root.innerHTML = `
      <div class="view-heading">
        <div><p class="eyebrow">Proof-backed side quest</p><h2>Pub bingo</h2><p>Build the board around your night, then claim squares with a note or photo.</p></div>
        <div class="view-actions">
          <button class="button button-secondary" type="button" data-action="manage-bingo">${icon("edit")}Manage board</button>
          <button class="button button-primary" type="button" data-action="manage-bingo">${icon("plus")}Add square</button>
        </div>
      </div>
      <section class="bingo-summary">
        <div>
          <strong>${complete} of ${night.bingo.length} squares claimed</strong>
          <p>${points} base bingo points earned across the group.</p>
          <div class="progress-bar" style="margin-top:10px"><span style="--progress:${progress}%"></span></div>
        </div>
        <div class="view-actions">
          <span class="pill pill-teal">${progress}% complete</span>
          <button class="button button-secondary button-small" type="button" data-action="manage-bingo">Manage</button>
        </div>
      </section>
      ${night.bingo.length ? `<section class="bingo-grid" aria-label="Pub bingo board">
        ${night.bingo.map((item) => {
          const person = getPerson(item.completedBy, night);
          const completeLabel = item.completedAt ? "View proof" : "Claim square";
          return `
            <button class="bingo-card ${item.completedAt ? "completed" : ""}" type="button" data-action="claim-bingo" data-id="${esc(item.id)}" aria-label="${completeLabel}: ${esc(item.title)}">
              <span class="bingo-check">${item.completedAt ? icon("check") : ""}</span>
              <span class="bingo-card-title">${esc(item.title)}</span>
              <span>
                <span class="bingo-points">+${item.points} bingo points</span>
                ${item.completedAt ? `<span class="proof-line">${icon(item.proofPhoto ? "image" : "check")}<span>${esc(person ? person.name : "Claimed")}</span></span>` : ""}
              </span>
            </button>
          `;
        }).join("")}
      </section>` : emptyState("grid", "Your board is clear", "Add your first pub bingo square and make the night yours.",
        `<div class="empty-actions"><button class="button button-primary" type="button" data-action="manage-bingo">${icon("plus")}Add square</button></div>`)}
    `;
  }

  function renderPlan() {
    const night = getNight();
    const visited = night.stops.filter((stop) => stop.visited).length;
    const money = calculateMoney(night);
    const groupBudget = Number(night.budget || 0) * Math.max(1, night.participants.length);
    const percent = groupBudget ? Math.min(100, Math.round(money.total / groupBudget * 100)) : 0;
    const route = night.stops.length
      ? `<div class="route-list">
          ${night.stops.map((stop, index) => `
            <article class="route-stop ${stop.visited ? "visited" : ""}">
              <div class="route-number">${stop.visited ? icon("check") : index + 1}</div>
              <div class="route-copy">
                <div class="route-top"><div><h4>${esc(stop.name)}</h4><p>${esc(stop.address || "Address to be decided")}</p></div><span class="pill ${stop.visited ? "pill-teal" : "pill-amber"}">${stop.visited ? "Visited" : esc(stop.time || "TBC")}</span></div>
                <div class="route-meta">
                  ${stop.aim ? `<span>${icon("spark", "inline-icon")}${esc(stop.aim)}</span>` : ""}
                  ${stop.notes ? `<span>${esc(stop.notes)}</span>` : ""}
                </div>
              </div>
              <div class="route-actions">
                <button class="icon-button" type="button" data-action="toggle-stop" data-id="${esc(stop.id)}" title="${stop.visited ? "Mark as planned" : "Check in"}" aria-label="${stop.visited ? "Mark as planned" : "Check in"}">${icon(stop.visited ? "close" : "check")}</button>
                <button class="icon-button" type="button" data-action="edit-stop" data-id="${esc(stop.id)}" title="Edit stop" aria-label="Edit stop">${icon("edit")}</button>
                <button class="icon-button" type="button" data-action="move-stop" data-id="${esc(stop.id)}" data-direction="up" title="Move up" aria-label="Move stop up" ${index === 0 ? "disabled" : ""}>${icon("chevron-up")}</button>
                <button class="icon-button" type="button" data-action="move-stop" data-id="${esc(stop.id)}" data-direction="down" title="Move down" aria-label="Move stop down" ${index === night.stops.length - 1 ? "disabled" : ""}>${icon("chevron-down")}</button>
              </div>
            </article>
          `).join("")}
        </div>`
      : emptyState("route", "Start the route", "Add the first place and the shape of the night appears.",
        `<div class="empty-actions"><button class="button button-primary" type="button" data-action="add-stop">${icon("plus")}Add stop</button></div>`);

    dom.root.innerHTML = `
      <div class="view-heading">
        <div><p class="eyebrow">Before and during</p><h2>Plan the next move</h2><p>Route, guests, budget, and check-ins in one place.</p></div>
        <div class="view-actions">
          <button class="button button-secondary" type="button" data-action="edit-night">${icon("edit")}Night details</button>
          <button class="button button-primary" type="button" data-action="add-stop">${icon("plus")}Add stop</button>
        </div>
      </div>
      <section class="plan-banner">
        <div><h3>${esc(night.title)}</h3><p>${formatDate(night.date)}${night.location ? " · " + esc(night.location) : ""}</p></div>
        <div class="plan-stat"><strong>${night.stops.length}</strong><span>planned stops</span></div>
        <div class="plan-stat"><strong>${visited}/${night.stops.length}</strong><span>checked in</span></div>
        <div class="plan-stat"><strong>${formatMoney(night.budget)}</strong><span>budget each</span></div>
      </section>
      <div class="content-grid">
        <section class="panel">
          <header class="panel-heading"><div><h3>Route</h3><p>Move stops around as the plan changes</p></div><button class="button button-small button-secondary" type="button" data-action="add-stop">${icon("plus")}Stop</button></header>
          <div class="panel-body panel-body-flush">${route}</div>
        </section>
        <aside class="side-stack">
          <section class="panel panel-teal">
            <header class="panel-heading"><div><h3>Budget tracker</h3><p>Drink and shared spend together</p></div></header>
            <div class="panel-body">
              <div class="budget-ring" style="--percentage:${percent}"><div class="budget-ring-copy"><strong>${percent}%</strong><span>of budget</span></div></div>
              <div class="setting-list">
                <div class="setting-row"><div class="setting-copy"><strong>Group budget</strong><span>${night.participants.length} people x ${formatMoney(night.budget)}</span></div><strong>${formatMoney(groupBudget)}</strong></div>
                <div class="setting-row"><div class="setting-copy"><strong>Logged spend</strong><span>Drinks and shared costs</span></div><strong>${formatMoney(money.total)}</strong></div>
              </div>
            </div>
          </section>
          <section class="panel">
            <header class="panel-heading"><div><h3>Guest list</h3><p>${night.participants.length} coming along</p></div><button class="text-button" type="button" data-action="manage-people">Manage</button></header>
            <div class="panel-body">
              <div class="guest-list">
                ${night.participants.map((person) => `<div class="guest-row">${avatar(person)}<div class="guest-name"><strong>${esc(person.name)}</strong><span>${night.drinks.filter((drink) => drink.personId === person.id).length} logs · ${(calculateScores(night).find((score) => score.person.id === person.id)?.total || 0).toFixed(1)} / 10 G score</span></div><span class="pill">Guest</span></div>`).join("")}
              </div>
              <button class="button button-secondary button-block" style="margin-top:12px" type="button" data-action="manage-people">${icon("users")}Manage guests</button>
            </div>
          </section>
        </aside>
      </div>
    `;
  }

  function render() {
    renderHeader();
    renderNav();
    if (ui.activeView === "scores") renderScores();
    else if (ui.activeView === "drinks") renderDrinks();
    else if (ui.activeView === "bingo") renderBingo();
    else if (ui.activeView === "plan") renderPlan();
    else renderReplay();
  }

  function openDialog({ eyebrow = "", title, body, submitLabel = "", submitClass = "button-primary", onSubmit = null, afterOpen = null, footer = "" }) {
    dialogSubmitHandler = onSubmit;
    dom.dialogEyebrow.textContent = eyebrow;
    dom.dialogEyebrow.style.display = eyebrow ? "" : "none";
    dom.dialogTitle.textContent = title;
    dom.dialogBody.innerHTML = body;
    dom.dialogFooter.innerHTML = footer + `<button class="button button-secondary" type="button" data-action="close-dialog">Cancel</button>`
      + (submitLabel ? `<button class="button ${submitClass}" type="submit" value="submit" data-label="${esc(submitLabel)}">${esc(submitLabel)}</button>` : "");
    if (!dom.dialog.open) dom.dialog.showModal();
    if (typeof afterOpen === "function") afterOpen();
  }

  function closeDialog() {
    if (dom.dialog.open) dom.dialog.close();
    dialogSubmitHandler = null;
  }

  function value(form, name) {
    const control = form.elements.namedItem(name);
    return control ? String(control.value || "").trim() : "";
  }

  function numericValue(form, name, fallback = 0) {
    const parsed = Number(value(form, name));
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function checkedValues(form, name) {
    return [...form.querySelectorAll(`input[name="${name}"]:checked`)].map((input) => input.value);
  }

  function openDrinkDialog(presetKey = "") {
    const night = getNight();
    if (!night.participants.length) {
      toast("Add a guest before logging a drink.", "error");
      openPeopleDialog();
      return;
    }
    const preset = DRINK_PRESETS[presetKey] || {};
    const selectedPerson = night.participants[0];
    const venues = venueOptions(night);
    openDialog({
      eyebrow: "Round tracker",
      title: presetKey ? "Log " + (preset.name || "drink") : "Log a drink",
      body: `
        <datalist id="drink-venues">${venues.map((venue) => `<option value="${esc(venue)}"></option>`).join("")}</datalist>
        <div class="form-grid">
          <div class="form-field"><label for="drink-person">Who had it?</label><select id="drink-person" name="personId">${participantOptions(night, selectedPerson.id)}</select></div>
          <div class="form-field"><label for="drink-payer">Who paid?</label><select id="drink-payer" name="payerId">${participantOptions(night, selectedPerson.id)}</select></div>
          <div class="form-field form-field-full"><label for="drink-name">What was it?</label><input id="drink-name" name="name" maxlength="80" value="${esc(preset.name || "")}" placeholder="e.g. House lager" required></div>
          <div class="form-field"><label for="drink-type">Type</label>
            <select id="drink-type" name="type">
              ${["beer", "guinness", "wine", "spirit", "cocktail", "soft", "water"].map((type) => `<option value="${type}" ${(preset.type || "beer") === type ? "selected" : ""}>${type === "soft" ? "0% / soft" : type === "guinness" ? "Guinness" : type[0].toUpperCase() + type.slice(1)}</option>`).join("")}
            </select>
          </div>
          <div class="form-field"><label for="drink-venue">Venue</label><input id="drink-venue" name="venue" list="drink-venues" maxlength="80" value="${esc(venues[venues.length - 1] || "")}" placeholder="e.g. The Lantern"></div>
          <div class="form-field"><label for="drink-units">Alcohol units</label><input id="drink-units" name="units" type="number" min="0" max="20" step="0.1" value="${preset.units ?? 0}"></div>
          <div class="form-field"><label for="drink-cost">Cost</label><input id="drink-cost" name="cost" type="number" min="0" max="999" step="0.01" value="${preset.cost ?? ""}" placeholder="0.00"></div>
          <div class="form-field form-field-full"><label for="drink-time">Time</label><input id="drink-time" name="time" type="time" value="${currentTimeForNight(night)}"></div>
        </div>
      `,
      submitLabel: "Save drink",
      onSubmit: (form) => {
        const personId = value(form, "personId");
        const name = value(form, "name");
        if (!personId || !name) {
          toast("Choose a guest and name the drink.", "error");
          return false;
        }
        night.drinks.push({
          id: uid("drink"),
          personId,
          payerId: value(form, "payerId") || personId,
          name,
          type: value(form, "type") || "beer",
          units: Math.max(0, numericValue(form, "units")),
          cost: Math.max(0, numericValue(form, "cost")),
          venue: value(form, "venue"),
          timestamp: eventTimestamp(night, value(form, "time"))
        });
        commit("Drink logged.");
        return true;
      }
    });
  }

  function bindImagePreview(inputId, previewId) {
    const input = document.getElementById(inputId);
    const preview = document.getElementById(previewId);
    if (!input || !preview) return;
    input.addEventListener("change", () => {
      const file = input.files && input.files[0];
      if (!file) {
        preview.classList.remove("visible");
        preview.removeAttribute("src");
        return;
      }
      const url = URL.createObjectURL(file);
      preview.src = url;
      preview.classList.add("visible");
      preview.onload = () => URL.revokeObjectURL(url);
    });
  }

  function readImageFile(file) {
    if (!file) return Promise.resolve("");
    if (!file.type.startsWith("image/")) return Promise.reject(new Error("Choose an image file for the proof."));
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("That image could not be read."));
      reader.onload = () => {
        const image = new Image();
        image.onerror = () => reject(new Error("That image could not be opened."));
        image.onload = () => {
          // Keep proof photos pleasantly clear while leaving room for a busy shared ledger.
          const limit = 960;
          const scale = Math.min(1, limit / Math.max(image.width, image.height));
          const width = Math.max(1, Math.round(image.width * scale));
          const height = Math.max(1, Math.round(image.height * scale));
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const context = canvas.getContext("2d");
          context.drawImage(image, 0, 0, width, height);
          resolve(canvas.toDataURL("image/jpeg", 0.72));
        };
        image.src = String(reader.result);
      };
      reader.readAsDataURL(file);
    });
  }

  function openMemoryDialog(momentId = "") {
    const night = getNight();
    if (!night.participants.length) {
      toast("Add a guest before creating a memory.", "error");
      openPeopleDialog();
      return;
    }
    const existing = momentId ? night.moments.find((moment) => moment.id === momentId) : null;
    openDialog({
      eyebrow: "Replay timeline",
      title: existing ? "Edit memory" : "Add a memory",
      body: `
        <div class="form-grid">
          <div class="form-field"><label for="memory-person">Moment owner</label><select id="memory-person" name="personId">${participantOptions(night, existing?.personId || night.participants[0].id)}</select></div>
          <div class="form-field"><label for="memory-time">Time</label><input id="memory-time" name="time" type="time" value="${existing ? String(existing.timestamp).slice(-5) : currentTimeForNight(night)}"></div>
          <div class="form-field form-field-full"><label for="memory-title">Headline</label><input id="memory-title" name="title" maxlength="100" value="${esc(existing?.title || "")}" placeholder="e.g. The one-take group photo" required></div>
          <div class="form-field form-field-full"><label for="memory-note">What happened?</label><textarea id="memory-note" name="note" maxlength="400" placeholder="The detail everyone will want tomorrow">${esc(existing?.note || "")}</textarea></div>
          <div class="form-field"><label for="memory-points">Story points</label><input id="memory-points" name="points" type="number" min="0" max="20" step="1" value="${existing?.points ?? night.scoreRules.momentPoint}"></div>
          <div class="form-field"><label>Photo</label><label class="upload-box" for="memory-photo">${icon("camera")}<span>Attach a photo<input id="memory-photo" name="photo" type="file" accept="image/*"></span></label></div>
          <div class="form-field form-field-full"><img class="upload-preview ${existing?.photo ? "visible" : ""}" id="memory-preview" src="${safeImageSrc(existing?.photo)}" alt=""></div>
        </div>
      `,
      submitLabel: existing ? "Save memory" : "Save memory",
      afterOpen: () => bindImagePreview("memory-photo", "memory-preview"),
      onSubmit: async (form) => {
        const personId = value(form, "personId");
        const title = value(form, "title");
        if (!personId || !title) {
          toast("Give the memory an owner and headline.", "error");
          return false;
        }
        let photo = existing?.photo || "";
        const imageInput = form.elements.namedItem("photo");
        if (imageInput && imageInput.files && imageInput.files[0]) {
          try {
            photo = await readImageFile(imageInput.files[0]);
          } catch (error) {
            toast(error.message, "error");
            return false;
          }
        }
        const record = {
          id: existing?.id || uid("moment"),
          personId,
          title,
          note: value(form, "note"),
          photo,
          points: Math.max(0, numericValue(form, "points", night.scoreRules.momentPoint)),
          timestamp: eventTimestamp(night, value(form, "time"))
        };
        if (existing) Object.assign(existing, record);
        else night.moments.push(record);
        commit(existing ? "Memory updated." : "Memory added.");
        return true;
      }
    });
  }

  function openGScoreDialog() {
    const night = getNight();
    if (!night.participants.length) {
      toast("Add a guest before scoring a Guinness split.", "error");
      openPeopleDialog();
      return;
    }
    const venues = venueOptions(night);
    openDialog({
      eyebrow: "Split the G",
      title: "Score a Guinness split",
      body: `
        <datalist id="g-split-venues">${venues.map((venue) => `<option value="${esc(venue)}"></option>`).join("")}</datalist>
        <div class="form-grid">
          <div class="form-field"><label for="g-person">Whose pint?</label><select id="g-person" name="personId">${participantOptions(night, night.participants[0].id)}</select></div>
          <div class="form-field"><label for="g-score">Split score</label><input id="g-score" name="score" type="number" min="0" max="10" step="0.1" value="8.0" required><span class="field-help">0 to 10, with 10 being immaculate.</span></div>
          <div class="form-field"><label for="g-venue">Venue</label><input id="g-venue" name="venue" list="g-split-venues" maxlength="80" value="${esc(venues[venues.length - 1] || "")}" placeholder="Where was it poured?"></div>
          <div class="form-field"><label for="g-time">Time</label><input id="g-time" name="time" type="time" value="${currentTimeForNight(night)}"></div>
          <div class="form-field form-field-full"><label for="g-note">Verdict</label><textarea id="g-note" name="note" maxlength="400" placeholder="Clean curve, too high, perfect line..."></textarea></div>
          <div class="form-field form-field-full"><label class="upload-box" for="g-photo">${icon("camera")}<span>Attach proof<input id="g-photo" name="photo" type="file" accept="image/*"></span></label><img class="upload-preview" id="g-preview" alt=""></div>
        </div>
      `,
      submitLabel: "Save G score",
      afterOpen: () => bindImagePreview("g-photo", "g-preview"),
      onSubmit: async (form) => {
        const score = numericValue(form, "score", -1);
        if (score < 0 || score > 10) {
          toast("Score the split from 0 to 10.", "error");
          return false;
        }
        let photo = "";
        const imageInput = form.elements.namedItem("photo");
        if (imageInput && imageInput.files && imageInput.files[0]) {
          try {
            photo = await readImageFile(imageInput.files[0]);
          } catch (error) {
            toast(error.message, "error");
            return false;
          }
        }
        night.gSplits.push({
          id: uid("g-split"),
          personId: value(form, "personId"),
          score,
          venue: value(form, "venue"),
          note: value(form, "note"),
          photo,
          timestamp: eventTimestamp(night, value(form, "time"))
        });
        commit("Guinness split scored.");
        return true;
      }
    });
  }

  function openBingoDialog(itemId) {
    const night = getNight();
    const item = night.bingo.find((entry) => entry.id === itemId);
    if (!item) return;
    const person = getPerson(item.completedBy, night);
    if (item.completedAt) {
      openDialog({
        eyebrow: "Bingo proof",
        title: item.title,
        body: `
          ${item.proofPhoto ? `<img class="proof-preview" src="${safeImageSrc(item.proofPhoto)}" alt="Proof for ${esc(item.title)}">` : ""}
          <div class="callout">
            <strong>Claimed by ${esc(person ? person.name : "Unknown")}</strong><br>
            ${item.proofNote ? esc(item.proofNote) : "No written note added."}<br>
            <span class="field-help">${formatDate(String(item.completedAt).slice(0, 10), { day: "numeric", month: "short" })} at ${formatTime(item.completedAt)} · +${item.points} bingo points</span>
          </div>
        `,
        footer: `<button class="button button-danger" type="button" data-action="undo-bingo" data-id="${esc(item.id)}">${icon("close")}Undo claim</button>`
      });
      return;
    }
    if (!night.participants.length) {
      toast("Add a guest before claiming a square.", "error");
      openPeopleDialog();
      return;
    }
    openDialog({
      eyebrow: "Pub bingo",
      title: "Claim: " + item.title,
      body: `
        <div class="form-grid">
          <div class="form-field"><label for="bingo-person">Who claimed it?</label><select id="bingo-person" name="personId">${participantOptions(night, night.participants[0].id)}</select></div>
          <div class="form-field"><label for="bingo-time">Time</label><input id="bingo-time" name="time" type="time" value="${currentTimeForNight(night)}"></div>
          <div class="form-field form-field-full"><label for="bingo-note">Proof note</label><textarea id="bingo-note" name="note" maxlength="400" placeholder="What happened?"></textarea><span class="field-help">A note or photo is needed for a claim.</span></div>
          <div class="form-field form-field-full"><label class="upload-box" for="bingo-photo">${icon("camera")}<span>Add photo proof<input id="bingo-photo" name="photo" type="file" accept="image/*"></span></label><img class="upload-preview" id="bingo-preview" alt=""></div>
        </div>
      `,
      submitLabel: "Claim square",
      afterOpen: () => bindImagePreview("bingo-photo", "bingo-preview"),
      onSubmit: async (form) => {
        const note = value(form, "note");
        const imageInput = form.elements.namedItem("photo");
        const hasPhoto = imageInput && imageInput.files && imageInput.files[0];
        if (!note && !hasPhoto) {
          toast("Add a proof note or a photo before claiming the square.", "error");
          return false;
        }
        let photo = "";
        if (hasPhoto) {
          try {
            photo = await readImageFile(imageInput.files[0]);
          } catch (error) {
            toast(error.message, "error");
            return false;
          }
        }
        item.completedBy = value(form, "personId");
        item.completedAt = eventTimestamp(night, value(form, "time"));
        item.proofNote = note;
        item.proofPhoto = photo;
        commit("Bingo square claimed.");
        return true;
      }
    });
  }

  function openBingoManager() {
    const night = getNight();
    openDialog({
      eyebrow: "Customise the board",
      title: "Manage pub bingo",
      body: `
        <div class="bingo-manage-list">
          ${night.bingo.map((item) => `
            <div class="bingo-manage-row">
              <input class="inline-input" name="bingo-title-${esc(item.id)}" maxlength="90" value="${esc(item.title)}" aria-label="Bingo title">
              <input class="inline-input" name="bingo-points-${esc(item.id)}" type="number" min="0" max="50" value="${item.points}" aria-label="Bingo points">
              <button class="icon-button icon-button-danger" type="button" data-action="delete-bingo-item" data-id="${esc(item.id)}" title="Remove square" aria-label="Remove ${esc(item.title)}">${icon("trash")}</button>
            </div>
          `).join("")}
        </div>
        <div class="form-grid" style="margin-top:18px;padding-top:18px;border-top:1px solid var(--line)">
          <div class="form-field form-field-full"><label for="new-bingo-title">New square</label><input id="new-bingo-title" name="newTitle" maxlength="90" placeholder="e.g. A great coat rack"></div>
          <div class="form-field"><label for="new-bingo-points">Bingo points</label><input id="new-bingo-points" name="newPoints" type="number" min="0" max="50" value="2"></div>
        </div>
      `,
      submitLabel: "Save board",
      onSubmit: (form) => {
        night.bingo.forEach((item) => {
          const title = value(form, "bingo-title-" + item.id);
          if (title) item.title = title;
          item.points = Math.max(0, numericValue(form, "bingo-points-" + item.id, item.points));
        });
        const newTitle = value(form, "newTitle");
        if (newTitle) {
          night.bingo.push({ id: uid("bingo"), title: newTitle, points: Math.max(0, numericValue(form, "newPoints", 2)), completedBy: null, completedAt: null, proofNote: "", proofPhoto: "" });
        }
        commit("Bingo board saved.");
        return true;
      }
    });
  }

  function openNightDialog(existing = true) {
    const night = getNight();
    openDialog({
      eyebrow: existing ? "Night details" : "Create a night",
      title: existing ? "Edit this night" : "Plan a new night",
      body: `
        <div class="form-grid">
          <div class="form-field form-field-full"><label for="night-name-input">Night name</label><input id="night-name-input" name="title" maxlength="100" value="${existing ? esc(night.title) : ""}" placeholder="e.g. Friday crawl" required></div>
          <div class="form-field"><label for="night-date-input">Date</label><input id="night-date-input" name="date" type="date" value="${existing ? esc(night.date) : localDate()}" required></div>
          <div class="form-field"><label for="night-budget-input">Budget per person</label><input id="night-budget-input" name="budget" type="number" min="0" max="999" step="0.01" value="${existing ? night.budget : 50}"></div>
          <div class="form-field form-field-full"><label for="night-location-input">Area or starting point</label><input id="night-location-input" name="location" maxlength="120" value="${existing ? esc(night.location) : ""}" placeholder="e.g. Northern Quarter"></div>
          ${existing ? `<div class="form-field form-field-full"><label for="night-status-input">Status</label><select id="night-status-input" name="status"><option value="planned" ${night.status === "planned" ? "selected" : ""}>Planned</option><option value="live" ${night.status === "live" ? "selected" : ""}>Live tonight</option><option value="complete" ${night.status === "complete" ? "selected" : ""}>Complete</option></select></div>` : `
          <div class="form-field form-field-full"><span class="field-label">Guests</span><label class="checkbox-card"><input type="checkbox" name="cloneGuests" checked>Bring the current guest list across</label></div>
          `}
        </div>
      `,
      submitLabel: existing ? "Save details" : "Create night",
      onSubmit: (form) => {
        const title = value(form, "title");
        if (!title) {
          toast("Give the night a name.", "error");
          return false;
        }
        if (existing) {
          night.title = title;
          night.date = value(form, "date") || night.date;
          night.location = value(form, "location");
          night.status = value(form, "status") || "planned";
          night.budget = Math.max(0, numericValue(form, "budget", 0));
          commit("Night details saved.");
        } else {
          const people = form.elements.namedItem("cloneGuests").checked ? night.participants : [];
          const newNight = createBlankNight({
            title,
            date: value(form, "date"),
            location: value(form, "location"),
            budget: numericValue(form, "budget", 50),
            participants: people
          });
          state.nights.unshift(newNight);
          state.activeNightId = newNight.id;
          ui.activeView = "plan";
          commit("New night created.");
        }
        return true;
      }
    });
  }

  function personIsInUse(personId, night) {
    return night.drinks.some((item) => item.personId === personId || item.payerId === personId)
      || night.moments.some((item) => item.personId === personId)
      || night.bingo.some((item) => item.completedBy === personId)
      || night.bonuses.some((item) => item.personId === personId)
      || night.expenses.some((item) => item.payerId === personId || item.splitAmongIds.includes(personId));
  }

  function openPeopleDialog() {
    const night = getNight();
    openDialog({
      eyebrow: "Guest list",
      title: "Manage people",
      body: `
        <div class="people-editor">
          ${night.participants.map((person) => `
            <div class="person-edit-row">
              ${avatar(person, "small")}
              <input class="inline-input" name="person-name-${esc(person.id)}" maxlength="50" value="${esc(person.name)}" aria-label="Name for ${esc(person.name)}">
              <button class="icon-button icon-button-danger" type="button" data-action="remove-person" data-id="${esc(person.id)}" title="Remove guest" aria-label="Remove ${esc(person.name)}" ${personIsInUse(person.id, night) ? "disabled" : ""}>${icon("trash")}</button>
            </div>
          `).join("")}
        </div>
        <div class="form-grid" style="margin-top:18px;padding-top:18px;border-top:1px solid var(--line)">
          <div class="form-field"><label for="new-person-name">New guest</label><input id="new-person-name" name="newName" maxlength="50" placeholder="Name"></div>
          <div class="form-field"><span class="field-label">Colour</span><div class="color-grid">
            ${PERSON_COLORS.map((color, index) => `<label class="color-swatch" style="--swatch:${color}" title="Choose colour"><input type="radio" name="newColor" value="${color}" ${index === night.participants.length % PERSON_COLORS.length ? "checked" : ""}><span class="sr-only">Colour ${index + 1}</span></label>`).join("")}
          </div></div>
        </div>
        <p class="field-help" style="margin:14px 0 0">Guests with existing logs stay locked to protect the ledger.</p>
      `,
      submitLabel: "Save people",
      onSubmit: (form) => {
        night.participants.forEach((person) => {
          const name = value(form, "person-name-" + person.id);
          if (name) person.name = name;
        });
        const newName = value(form, "newName");
        if (newName) {
          night.participants.push({
            id: uid("person"),
            name: newName,
            color: value(form, "newColor") || PERSON_COLORS[night.participants.length % PERSON_COLORS.length]
          });
        }
        commit("Guest list saved.");
        return true;
      }
    });
  }

  function openScoreRulesDialog() {
    const night = getNight();
    const rules = night.scoreRules;
    openDialog({
      eyebrow: "House rules",
      title: "Set the G score",
      body: `
        <div class="callout">Drink logs score only up to the cap. That leaves the board open to good moments, bingo, venues, and water.</div>
        <div class="setting-list" style="margin-top:12px">
          <div class="setting-row"><div class="setting-copy"><strong>Points per drink log</strong><span>Alcohol logs only</span></div><div class="stepper"><button type="button" data-stepper="drinkPoint" data-delta="-1" aria-label="Decrease drink points">-</button><input name="drinkPoint" type="number" min="0" max="10" value="${rules.drinkPoint}"><button type="button" data-stepper="drinkPoint" data-delta="1" aria-label="Increase drink points">+</button></div></div>
          <div class="setting-row"><div class="setting-copy"><strong>Drink point cap</strong><span>Maximum contribution from drink logs</span></div><div class="stepper"><button type="button" data-stepper="drinkCap" data-delta="-1" aria-label="Decrease cap">-</button><input name="drinkCap" type="number" min="0" max="30" value="${rules.drinkCap}"><button type="button" data-stepper="drinkCap" data-delta="1" aria-label="Increase cap">+</button></div></div>
          <div class="setting-row"><div class="setting-copy"><strong>Points per venue</strong><span>Each distinct stop</span></div><div class="stepper"><button type="button" data-stepper="venuePoint" data-delta="-1" aria-label="Decrease venue points">-</button><input name="venuePoint" type="number" min="0" max="10" value="${rules.venuePoint}"><button type="button" data-stepper="venuePoint" data-delta="1" aria-label="Increase venue points">+</button></div></div>
          <div class="setting-row"><div class="setting-copy"><strong>Points per water</strong><span>Each water log</span></div><div class="stepper"><button type="button" data-stepper="waterPoint" data-delta="-1" aria-label="Decrease water points">-</button><input name="waterPoint" type="number" min="0" max="10" value="${rules.waterPoint}"><button type="button" data-stepper="waterPoint" data-delta="1" aria-label="Increase water points">+</button></div></div>
          <div class="setting-row"><div class="setting-copy"><strong>Bingo multiplier</strong><span>Applies to bingo square points</span></div><div class="stepper"><button type="button" data-stepper="bingoMultiplier" data-delta="-1" aria-label="Decrease bingo multiplier">-</button><input name="bingoMultiplier" type="number" min="0" max="10" value="${rules.bingoMultiplier}"><button type="button" data-stepper="bingoMultiplier" data-delta="1" aria-label="Increase bingo multiplier">+</button></div></div>
          <div class="setting-row"><div class="setting-copy"><strong>Default memory points</strong><span>Used for new memories</span></div><div class="stepper"><button type="button" data-stepper="momentPoint" data-delta="-1" aria-label="Decrease memory points">-</button><input name="momentPoint" type="number" min="0" max="20" value="${rules.momentPoint}"><button type="button" data-stepper="momentPoint" data-delta="1" aria-label="Increase memory points">+</button></div></div>
        </div>
      `,
      submitLabel: "Save rules",
      onSubmit: (form) => {
        Object.keys(rules).forEach((key) => {
          rules[key] = Math.max(0, numericValue(form, key, rules[key]));
        });
        commit("G score rules saved.");
        return true;
      }
    });
  }

  function openBonusDialog() {
    const night = getNight();
    if (!night.participants.length) {
      openPeopleDialog();
      return;
    }
    openDialog({
      eyebrow: "Bonus board",
      title: "Add G score bonus",
      body: `
        <div class="form-grid">
          <div class="form-field"><label for="bonus-person">Guest</label><select id="bonus-person" name="personId">${participantOptions(night, night.participants[0].id)}</select></div>
          <div class="form-field"><label for="bonus-points">Points</label><input id="bonus-points" name="points" type="number" min="1" max="50" step="1" value="2"></div>
          <div class="form-field form-field-full"><label for="bonus-description">What earned it?</label><input id="bonus-description" name="description" maxlength="100" placeholder="e.g. Found the only free table" required></div>
          <div class="form-field form-field-full"><label for="bonus-time">Time</label><input id="bonus-time" name="time" type="time" value="${currentTimeForNight(night)}"></div>
        </div>
      `,
      submitLabel: "Add bonus",
      onSubmit: (form) => {
        const description = value(form, "description");
        if (!description) {
          toast("Add a short reason for the bonus.", "error");
          return false;
        }
        night.bonuses.push({
          id: uid("bonus"),
          personId: value(form, "personId"),
          description,
          points: Math.max(1, numericValue(form, "points", 2)),
          timestamp: eventTimestamp(night, value(form, "time"))
        });
        commit("Bonus added.");
        return true;
      }
    });
  }

  function openExpenseDialog() {
    const night = getNight();
    if (!night.participants.length) {
      openPeopleDialog();
      return;
    }
    openDialog({
      eyebrow: "Settle up",
      title: "Add shared cost",
      body: `
        <div class="form-grid">
          <div class="form-field form-field-full"><label for="expense-description">What was it?</label><input id="expense-description" name="description" maxlength="100" placeholder="e.g. Taxi to the first pub" required></div>
          <div class="form-field"><label for="expense-cost">Cost</label><input id="expense-cost" name="cost" type="number" min="0.01" max="9999" step="0.01" placeholder="0.00" required></div>
          <div class="form-field"><label for="expense-payer">Who paid?</label><select id="expense-payer" name="payerId">${participantOptions(night, night.participants[0].id)}</select></div>
          <div class="form-field form-field-full"><span class="field-label">Split between</span><div class="checkbox-grid">
            ${night.participants.map((person) => `<label class="checkbox-card">${avatar(person, "small")}<span>${esc(person.name)}</span><input type="checkbox" name="splitAmong" value="${esc(person.id)}" checked></label>`).join("")}
          </div></div>
          <div class="form-field form-field-full"><label for="expense-time">Time</label><input id="expense-time" name="time" type="time" value="${currentTimeForNight(night)}"></div>
        </div>
      `,
      submitLabel: "Add cost",
      onSubmit: (form) => {
        const description = value(form, "description");
        const splitAmongIds = checkedValues(form, "splitAmong");
        const cost = numericValue(form, "cost");
        if (!description || cost <= 0 || !splitAmongIds.length) {
          toast("Add a name, cost, and at least one person to split it.", "error");
          return false;
        }
        night.expenses.push({
          id: uid("expense"),
          description,
          cost,
          payerId: value(form, "payerId"),
          splitAmongIds,
          timestamp: eventTimestamp(night, value(form, "time"))
        });
        commit("Shared cost added.");
        return true;
      }
    });
  }

  function openStopDialog(stopId = "") {
    const night = getNight();
    const existing = stopId ? night.stops.find((stop) => stop.id === stopId) : null;
    openDialog({
      eyebrow: "Route",
      title: existing ? "Edit stop" : "Add a stop",
      body: `
        <div class="form-grid">
          <div class="form-field form-field-full"><label for="stop-name">Place</label><input id="stop-name" name="name" maxlength="100" value="${esc(existing?.name || "")}" placeholder="e.g. Fox & Fir" required></div>
          <div class="form-field"><label for="stop-time">Target time</label><input id="stop-time" name="time" type="time" value="${esc(existing?.time || "20:00")}"></div>
          <div class="form-field"><label for="stop-aim">Aim</label><input id="stop-aim" name="aim" maxlength="80" value="${esc(existing?.aim || "")}" placeholder="e.g. Food first"></div>
          <div class="form-field form-field-full"><label for="stop-address">Address or area</label><input id="stop-address" name="address" maxlength="140" value="${esc(existing?.address || "")}" placeholder="e.g. 42 Swan Street"></div>
          <div class="form-field form-field-full"><label for="stop-notes">Notes</label><textarea id="stop-notes" name="notes" maxlength="400" placeholder="Booking, table, what to try, or anything useful">${esc(existing?.notes || "")}</textarea></div>
        </div>
      `,
      submitLabel: existing ? "Save stop" : "Add stop",
      footer: existing ? `<button class="button button-danger" type="button" data-action="delete-stop" data-id="${esc(existing.id)}">${icon("trash")}Delete stop</button>` : "",
      onSubmit: (form) => {
        const name = value(form, "name");
        if (!name) {
          toast("Name the stop first.", "error");
          return false;
        }
        const record = {
          id: existing?.id || uid("stop"),
          name,
          time: value(form, "time"),
          aim: value(form, "aim"),
          address: value(form, "address"),
          notes: value(form, "notes"),
          visited: existing?.visited || false,
          visitedAt: existing?.visitedAt || null
        };
        if (existing) Object.assign(existing, record);
        else night.stops.push(record);
        commit(existing ? "Stop updated." : "Stop added to the route.");
        return true;
      }
    });
  }

  function openSettings() {
    const night = getNight();
    openDialog({
      eyebrow: "Night Ledger",
      title: "Settings and backups",
      body: `
        <section class="data-section">
          <h3>Current night</h3>
          <p>${esc(night.title)} · ${formatDate(night.date)}</p>
          <div class="data-action-row">
            <button class="button button-secondary button-small" type="button" data-action="edit-night">${icon("edit")}Edit details</button>
            <button class="button button-secondary button-small" type="button" data-action="manage-people">${icon("users")}Guests</button>
            <button class="button button-secondary button-small" type="button" data-action="new-night">${icon("plus")}New night</button>
          </div>
        </section>
        <section class="data-section">
          <h3>Data</h3>
          <p>Back up your nights before moving to another device.</p>
          <div class="data-action-row">
            <button class="button button-secondary button-small" type="button" data-action="export-data">${icon("download")}Export backup</button>
            <button class="button button-secondary button-small" type="button" data-action="import-data">${icon("upload")}Import backup</button>
          </div>
        </section>
        <section class="data-section">
          <h3>Demo data</h3>
          <p>Restore the sample nights used in this app.</p>
          <div class="data-action-row"><button class="button button-secondary button-small" type="button" data-action="reset-demo">${icon("replay")}Restore demo</button></div>
        </section>
        ${state.nights.length > 1 ? `<section class="data-section"><h3>Delete this night</h3><p>Only this selected night will be removed.</p><div class="data-action-row"><button class="button button-danger button-small" type="button" data-action="delete-night">${icon("trash")}Delete night</button></div></section>` : ""}
      `
    });
  }

  function openAccountDialog() {
    if (account.user) openGroupsDialog();
    else openAuthDialog("login");
  }

  function openAuthDialog(mode = "login") {
    const creating = mode === "signup";
    openDialog({
      eyebrow: "Night Ledger account",
      title: creating ? "Create an account" : "Sign in",
      body: `
        <div class="segmented-control" style="margin-bottom:18px">
          <button class="segment ${!creating ? "active" : ""}" type="button" data-action="auth-mode" data-mode="login">Sign in</button>
          <button class="segment ${creating ? "active" : ""}" type="button" data-action="auth-mode" data-mode="signup">Create account</button>
        </div>
        <div class="form-grid">
          ${creating ? `<div class="form-field form-field-full"><label for="account-name">Display name</label><input id="account-name" name="displayName" maxlength="50" placeholder="How should the group know you?" required></div>` : ""}
          <div class="form-field form-field-full"><label for="account-email">Email</label><input id="account-email" name="email" type="email" autocomplete="email" maxlength="120" placeholder="you@example.com" required></div>
          <div class="form-field form-field-full"><label for="account-password">Password</label><input id="account-password" name="password" type="password" autocomplete="${creating ? "new-password" : "current-password"}" minlength="8" maxlength="200" placeholder="At least 8 characters" required></div>
        </div>
      `,
      submitLabel: creating ? "Create account" : "Sign in",
      onSubmit: async (form) => {
        try {
          const body = {
            email: value(form, "email"),
            password: value(form, "password")
          };
          if (creating) body.displayName = value(form, "displayName");
          const payload = await api(creating ? "/api/auth/signup" : "/api/auth/login", {
            method: "POST",
            body: JSON.stringify(body)
          });
          account.user = payload.user;
          const groupPayload = await api("/api/groups");
          account.groups = groupPayload.groups || [];
          render();
          toast(creating ? "Account created." : "Signed in.");
          return true;
        } catch (error) {
          toast(error.message, "error");
          return false;
        }
      }
    });
  }

  function openGroupsDialog() {
    const active = getActiveGroup();
    openDialog({
      eyebrow: "Shared ledger",
      title: "Account and groups",
      body: `
        <section class="data-section">
          <h3>Signed in as</h3>
          <p>${esc(account.user.displayName)} · ${esc(account.user.email)}</p>
        </section>
        <section class="data-section">
          <h3>Your groups</h3>
          ${account.groups.length ? `<div class="group-list">
            ${account.groups.map((group) => `
              <button class="group-row ${active && active.id === group.id ? "active" : ""}" type="button" data-action="activate-group" data-id="${esc(group.id)}">
                <span class="group-row-main"><strong>${esc(group.name)}</strong><span>${group.memberCount} ${plural(group.memberCount, "member")} · invite ${esc(group.inviteCode)}</span></span>
                <span class="pill ${active && active.id === group.id ? "pill-teal" : ""}">${active && active.id === group.id ? "Active" : "Open"}</span>
              </button>
            `).join("")}
          </div>` : `<div class="callout">Create a group to share this ledger, or join one with an invite code.</div>`}
          <div class="data-action-row" style="margin-top:14px">
            <button class="button button-secondary button-small" type="button" data-action="create-group">${icon("plus")}Create group</button>
            <button class="button button-secondary button-small" type="button" data-action="join-group">${icon("users")}Join with code</button>
          </div>
        </section>
      `,
      footer: `<button class="button button-danger" type="button" data-action="sign-out">Sign out</button>`
    });
  }

  function openCreateGroupDialog() {
    openDialog({
      eyebrow: "Shared ledger",
      title: "Create a group",
      body: `
        <div class="form-grid">
          <div class="form-field form-field-full"><label for="group-name">Group name</label><input id="group-name" name="name" maxlength="80" placeholder="e.g. The Friday lot" required></div>
          <div class="form-field form-field-full"><label class="check-row"><input type="checkbox" name="freshLedger" checked> Start with a fresh shared night</label></div>
        </div>
      `,
      submitLabel: "Create group",
      onSubmit: async (form) => {
        try {
          const name = value(form, "name");
          let startingLedger = state;
          if (form.elements.namedItem("freshLedger")?.checked) {
            const firstNight = createBlankNight({
              title: name + " night out",
              date: localDate(),
              location: "",
              budget: 50,
              participants: account.user ? [{ name: account.user.displayName, color: PERSON_COLORS[0] }] : []
            });
            startingLedger = { version: STATE_VERSION, activeNightId: firstNight.id, nights: [firstNight] };
          }
          const payload = await api("/api/groups", {
            method: "POST",
            body: JSON.stringify({ name, ledger: startingLedger })
          });
          account.groups.push(payload.group);
          await setActiveGroup(payload.group.id, payload.ledger, true);
          toast("Group created. Invite code: " + payload.group.inviteCode);
          return true;
        } catch (error) {
          toast(error.message, "error");
          return false;
        }
      }
    });
  }

  function openJoinGroupDialog() {
    openDialog({
      eyebrow: "Shared ledger",
      title: "Join a group",
      body: `
        <div class="form-grid">
          <div class="form-field form-field-full"><label for="invite-code">Invite code</label><input id="invite-code" name="inviteCode" maxlength="12" autocapitalize="characters" placeholder="e.g. A1B2C3D" required><span class="field-help">The group owner can find this beside the group name.</span></div>
        </div>
      `,
      submitLabel: "Join group",
      onSubmit: async (form) => {
        try {
          const payload = await api("/api/groups/join", {
            method: "POST",
            body: JSON.stringify({ inviteCode: value(form, "inviteCode") })
          });
          if (!account.groups.some((group) => group.id === payload.group.id)) account.groups.push(payload.group);
          await setActiveGroup(payload.group.id, payload.ledger, true);
          if (addCurrentUserToActiveNight()) commit("Added you to the guest list.");
          toast("Joined " + payload.group.name + ".");
          return true;
        } catch (error) {
          toast(error.message, "error");
          return false;
        }
      }
    });
  }

  function openConfirmDialog({ eyebrow = "Confirm", title, copy, confirmLabel, confirmClass = "button-danger", onConfirm }) {
    openDialog({
      eyebrow,
      title,
      body: `<div class="callout callout-danger">${esc(copy)}</div>`,
      submitLabel: confirmLabel,
      submitClass: confirmClass,
      onSubmit: () => {
        onConfirm();
        return true;
      }
    });
  }

  function exportData() {
    const payload = JSON.stringify(state, null, 2);
    const blob = new Blob([payload], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "night-ledger-backup-" + localDate() + ".json";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    toast("Backup exported.");
  }

  async function importData(file) {
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const imported = normaliseState(parsed);
      if (!imported.nights.length) throw new Error("No nights were found in that file.");
      state = imported;
      ui.activeView = "replay";
      ui.scoreTab = "scores";
      ui.drinkPerson = "all";
      ui.drinkVenue = "all";
      ui.timelineType = "all";
      saveState();
      closeDialog();
      render();
      toast("Backup imported.");
    } catch (error) {
      toast(error.message || "That backup could not be imported.", "error");
    } finally {
      dom.importFile.value = "";
    }
  }

  function deleteRecord(collection, id, message) {
    const night = getNight();
    const index = night[collection].findIndex((item) => item.id === id);
    if (index === -1) return;
    night[collection].splice(index, 1);
    commit(message);
  }

  function removePerson(personId) {
    const night = getNight();
    const person = getPerson(personId, night);
    if (!person) return;
    if (personIsInUse(personId, night)) {
      toast("This guest has ledger history, so they cannot be removed.", "error");
      return;
    }
    night.participants = night.participants.filter((entry) => entry.id !== personId);
    commit(person.name + " removed.");
    openPeopleDialog();
  }

  function deleteCurrentNight() {
    if (state.nights.length < 2) {
      toast("Keep at least one night in the ledger.", "error");
      return;
    }
    const night = getNight();
    state.nights = state.nights.filter((entry) => entry.id !== night.id);
    state.activeNightId = state.nights[0].id;
    ui.activeView = "replay";
    commit("Night deleted.");
  }

  async function handleAction(button, event) {
    const action = button.dataset.action;
    const night = getNight();
    const id = button.dataset.id;

    switch (action) {
      case "go-home":
        event.preventDefault();
        ui.activeView = "replay";
        render();
        break;
      case "close-dialog":
        closeDialog();
        break;
      case "new-night":
        openNightDialog(false);
        break;
      case "open-settings":
        openSettings();
        break;
      case "open-account":
        openAccountDialog();
        break;
      case "auth-mode":
        openAuthDialog(button.dataset.mode);
        break;
      case "create-group":
        openCreateGroupDialog();
        break;
      case "join-group":
        openJoinGroupDialog();
        break;
      case "activate-group":
        try {
          closeDialog();
          await setActiveGroup(id);
        } catch (error) {
          toast(error.message, "error");
        }
        break;
      case "sign-out":
        try {
          await api("/api/auth/logout", { method: "POST" });
        } catch {
          /* The local session is still cleared even if the server has gone away. */
        }
        account.user = null;
        account.groups = [];
        account.activeGroupId = "";
        localStorage.removeItem(ACTIVE_GROUP_KEY);
        closeDialog();
        render();
        toast("Signed out.");
        break;
      case "edit-night":
        openNightDialog(true);
        break;
      case "manage-people":
        openPeopleDialog();
        break;
      case "score-rules":
        openScoreRulesDialog();
        break;
      case "add-drink":
        openDrinkDialog();
        break;
      case "quick-drink":
        openDrinkDialog(button.dataset.preset);
        break;
      case "add-memory":
        openMemoryDialog();
        break;
      case "add-g-score":
        openGScoreDialog();
        break;
      case "view-memory":
        openMemoryDialog(id);
        break;
      case "add-bonus":
        openBonusDialog();
        break;
      case "add-expense":
        openExpenseDialog();
        break;
      case "add-stop":
        openStopDialog();
        break;
      case "context-add":
        if (ui.activeView === "drinks") openDrinkDialog();
        else if (ui.activeView === "bingo") openBingoManager();
        else if (ui.activeView === "plan") openStopDialog();
        else if (ui.activeView === "scores") {
          if (ui.scoreTab === "split") openExpenseDialog();
          else openGScoreDialog();
        } else openMemoryDialog();
        break;
      case "edit-stop":
        openStopDialog(id);
        break;
      case "delete-stop":
        closeDialog();
        deleteRecord("stops", id, "Stop removed from the route.");
        break;
      case "toggle-stop": {
        const stop = night.stops.find((entry) => entry.id === id);
        if (!stop) return;
        stop.visited = !stop.visited;
        stop.visitedAt = stop.visited ? eventTimestamp(night, currentTimeForNight(night)) : null;
        commit(stop.visited ? "Checked in at " + stop.name + "." : stop.name + " moved back to planned.");
        break;
      }
      case "move-stop": {
        const index = night.stops.findIndex((entry) => entry.id === id);
        const next = button.dataset.direction === "up" ? index - 1 : index + 1;
        if (index < 0 || next < 0 || next >= night.stops.length) return;
        [night.stops[index], night.stops[next]] = [night.stops[next], night.stops[index]];
        commit("Route reordered.");
        break;
      }
      case "manage-bingo":
        openBingoManager();
        break;
      case "claim-bingo":
        openBingoDialog(id);
        break;
      case "undo-bingo": {
        const item = night.bingo.find((entry) => entry.id === id);
        if (!item) return;
        item.completedBy = null;
        item.completedAt = null;
        item.proofNote = "";
        item.proofPhoto = "";
        closeDialog();
        commit("Bingo claim undone.");
        break;
      }
      case "delete-bingo-item": {
        const item = night.bingo.find((entry) => entry.id === id);
        if (!item) return;
        night.bingo = night.bingo.filter((entry) => entry.id !== id);
        commit("Bingo square removed.");
        openBingoManager();
        break;
      }
      case "delete-drink":
        deleteRecord("drinks", id, "Drink removed.");
        break;
      case "delete-bonus":
        deleteRecord("bonuses", id, "Bonus removed.");
        break;
      case "delete-g-split":
        deleteRecord("gSplits", id, "Guinness split removed.");
        break;
      case "delete-expense":
        deleteRecord("expenses", id, "Shared cost removed.");
        break;
      case "delete-timeline-item":
        deleteRecord(button.dataset.kind === "memory" ? "moments" : button.dataset.kind === "gsplit" ? "gSplits" : "drinks", id, "Timeline entry removed.");
        break;
      case "remove-person":
        removePerson(id);
        break;
      case "open-split":
        ui.activeView = "scores";
        ui.scoreTab = "split";
        render();
        break;
      case "print-night":
        window.print();
        break;
      case "export-data":
        exportData();
        break;
      case "import-data":
        dom.importFile.click();
        break;
      case "reset-demo":
        openConfirmDialog({
          eyebrow: "Restore demo",
          title: "Restore the sample nights?",
          copy: "This replaces every saved night on this device with the original demo data.",
          confirmLabel: "Restore demo",
          onConfirm: () => {
            state = createSeedState();
            ui.activeView = "replay";
            ui.scoreTab = "scores";
            ui.drinkPerson = "all";
            ui.drinkVenue = "all";
            ui.timelineType = "all";
            commit("Demo data restored.");
          }
        });
        break;
      case "delete-night":
        openConfirmDialog({
          eyebrow: "Delete night",
          title: "Delete " + night.title + "?",
          copy: "This removes the selected night and all of its saved logs, proof, scores, and plan.",
          confirmLabel: "Delete night",
          onConfirm: deleteCurrentNight
        });
        break;
      default:
        break;
    }
  }

  document.addEventListener("click", (event) => {
    const viewButton = event.target.closest("[data-view]");
    if (viewButton) {
      event.preventDefault();
      ui.activeView = viewButton.dataset.view;
      render();
      return;
    }

    const tabButton = event.target.closest("[data-score-tab]");
    if (tabButton) {
      ui.scoreTab = tabButton.dataset.scoreTab;
      render();
      return;
    }

    const stepperButton = event.target.closest("[data-stepper]");
    if (stepperButton) {
      const input = dom.dialogBody.querySelector(`input[name="${stepperButton.dataset.stepper}"]`);
      if (input) {
        const current = Number(input.value) || 0;
        input.value = Math.max(0, current + Number(stepperButton.dataset.delta || 0));
      }
      return;
    }

    const actionButton = event.target.closest("[data-action]");
    if (actionButton && !actionButton.disabled) {
      handleAction(actionButton, event);
    }
  });

  document.addEventListener("change", (event) => {
    if (event.target.id === "night-select") {
      state.activeNightId = event.target.value;
      ui.drinkPerson = "all";
      ui.drinkVenue = "all";
      ui.timelineType = "all";
      saveState();
      render();
      return;
    }
    if (event.target.id === "drink-person-filter") {
      ui.drinkPerson = event.target.value;
      renderDrinks();
      return;
    }
    if (event.target.id === "drink-venue-filter") {
      ui.drinkVenue = event.target.value;
      renderDrinks();
      return;
    }
    if (event.target.id === "timeline-type") {
      ui.timelineType = event.target.value;
      renderReplay();
    }
  });

  dom.dialogForm.addEventListener("submit", async (event) => {
    if (event.submitter && event.submitter.value !== "submit") return;
    event.preventDefault();
    if (typeof dialogSubmitHandler !== "function") return;
    const submitter = event.submitter;
    if (submitter) {
      submitter.disabled = true;
      submitter.textContent = "Saving...";
    }
    try {
      const result = await dialogSubmitHandler(dom.dialogForm);
      if (result !== false) closeDialog();
    } catch (error) {
      console.error(error);
      toast("That could not be saved. Please try again.", "error");
    } finally {
      if (submitter && dom.dialog.open) {
        submitter.disabled = false;
        submitter.textContent = submitter.dataset.label || "Save";
      }
    }
  });

  dom.dialog.addEventListener("close", () => {
    dialogSubmitHandler = null;
  });

  dom.importFile.addEventListener("change", () => {
    importData(dom.importFile.files && dom.importFile.files[0]);
  });

  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch(() => {
        /* The app still works without offline caching. */
      });
    });
  }

  window.__nightLedger = {
    getState: () => structuredClone(state),
    reset: () => {
      state = createSeedState();
      saveState();
      render();
    }
  };

  async function bootstrap() {
    await refreshAccount();
    if (account.user && getActiveGroup()) {
      try {
        await setActiveGroup(account.activeGroupId, null, true);
        return;
      } catch {
        account.activeGroupId = "";
        localStorage.removeItem(ACTIVE_GROUP_KEY);
      }
    }
    render();
  }

  bootstrap();
})();
