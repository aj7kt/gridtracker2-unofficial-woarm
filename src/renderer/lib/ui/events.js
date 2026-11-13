// GridTracker Copyright © 2026 GridTracker.org
// All rights reserved.
// See LICENSE for more information.

// The Event Viewer: what the control panel's traffic list used to show (QSOs logged, alerts, BirdWatch's announcements, errors...) is
// kept as events, newest first, this session's and never older than a day; nothing is saved to disk. They are shown in the main window
// (a panel like Settings; one of those is open at a time) or in a window of their own (gt_events.html), as the button panel's Event
// Viewer button is set (a right click on it: View In Main / View As Window). A list
// draws only the rows in view (virtual scrolling, like the Satellites lists), and its columns are as wide as the widest row seen, never
// narrower (until Clear); the Event column wraps to the list's width, so a row is one line or more (its height reckoned from its text's
// width, and kept once it has been drawn)

const EVENTS_KEEP_MS = 24 * 3600 * 1000;
const EVENTS_ROW = 20;
const EVENTS_LINE = 16;
const EVENTS_BUFFER = 8;

// Each { time (ms), source (the key of its name, events.source.<source>), text (html, one line) }
GT.events = [];
// The widest time, source and text seen, in px: the columns' widths, which only grow
GT.eventsWidths = { time: 0, source: 0, text: 0 };

// An event from a part of the app: source "app", "log", "decode", "wsjtx", "mmd", "aclog", "log4om", "n3fjp" (an N3FJP contest log),
// "roster", "birdwatch", "rotor", "sota" or "cast"; html the text
// (html coloring allowed; a message's line breaks become spaces). error: an error, which opens the Event Viewer (Settings -> General,
// Open Event Viewer On Error); by default one said in red (the theme's error color), as the app says its errors
function addEvent(source, html, error = /color:\s*red\b|color=["']red["']|var\(--gt-error\)/i.test(String(html)))
{
  const now = Date.now();
  const event = { time: now, source: source, text: String(html).replace(/<br\s*\/?>/gi, " ") };
  GT.events.unshift(event);
  eventsPrune(now);
  eventsMeasure(event);
  eventsRedraw(true, event);
  if (error && GT.settings.app.openEventViewerOnError) eventViewerOpen();
}

// The Event Viewer shown where it is set to be (the main window's panel, or its window), if it isn't already (Open Event Viewer On
// Error). In View As Waterfall nothing: the events are in the control panel already, and a control panel the user collapsed stays so
function eventViewerOpen()
{
  try
  {
    if (GT.settings.app.eventViewer == "panel") return;
    if (GT.settings.app.eventViewer == "window") eventsWindowOpen(true);
    else if (typeof eventViewerDiv != "undefined" && eventViewerDiv.style.display != "inline-flex")
    {
      eventsWindowOpen(false);
      eventViewerShowMain();
    }
  }
  catch (e)
  {
    // Not set up yet (an error at startup): it is there in the list when the user opens it
  }
}

// Nothing older than a day (the list is newest first)
function eventsPrune(now)
{
  while (GT.events.length && now - GT.events[GT.events.length - 1].time > EVENTS_KEEP_MS) GT.events.pop();
}

function eventsSourceName(source)
{
  return I18N("events.source." + source);
}

// The text of an event's html, for its width
function eventsPlainText(html)
{
  const div = eventsPlainText.div || (eventsPlainText.div = document.createElement("div"));
  div.innerHTML = html;
  return div.textContent;
}

// The columns grow to fit an event (or every event again: force), and every list follows
function eventsMeasure(event, force = false)
{
  const W = GT.eventsWidths;
  const context = (eventsMeasure.canvas || (eventsMeasure.canvas = document.createElement("canvas"))).getContext("2d");
  context.font = "bold 12px Sans-Serif";
  const width = (text) => Math.ceil(context.measureText(text).width);
  if (force)
  {
    W.time = width(I18N("events.time.label"));
    W.source = width(I18N("events.source.label"));
    // The Event column's header holds the events' count (its margin and up to five digits) and Clear (its text and padding) too; the
    // main window's panel's also its X (eventsApplyWidths)
    W.head = width(I18N("events.text.label")) + 6 + width("00000") + 10 + width(I18N("events.clear.label")) + 16;
    W.text = W.head;
  }
  context.font = "12px Sans-Serif";
  for (const e of force ? GT.events : [event])
  {
    W.time = Math.max(W.time, width(eventsTimeString(e.time)));
    W.source = Math.max(W.source, width(eventsSourceName(e.source)));
    // Its text's width on one line, for its height where the Event column wraps it
    e.textWidth = width(eventsPlainText(eventsRowHtml(e)));
    W.text = Math.max(W.text, e.textWidth);
  }
  for (const list of eventsLists()) eventsApplyWidths(list);
}

function eventsApplyWidths(list)
{
  const W = GT.eventsWidths;
  // A little over what the text needs, for the scaling of text on some screens
  list.style.setProperty("--evTime", W.time + 8 + "px");
  list.style.setProperty("--evSource", W.source + 8 + "px");
  // (the main window's panel's header holds its X too: its width and margin)
  const text = typeof eventsListMain != "undefined" && list === eventsListMain ? Math.max(W.text, (W.head || 0) + 28) : W.text;
  list.style.setProperty("--evText", text + 8 + "px");
}

// An event's text as shown: your call in yellow and the DX call in cyan, as the traffic list had them
function eventsRowHtml(event)
{
  let text = event.text;
  if (GT.localDXcall && GT.localDXcall.length > 1) text = text.replaceAll(GT.localDXcall, "<font style='color:var(--gt-callsign-other)'>" + GT.localDXcall + "</font>");
  if (GT.settings.app.myRawCall.length > 1) text = text.replaceAll(GT.settings.app.myRawCall, "<font style='color:var(--gt-callsign)'>" + GT.settings.app.myRawCall + "</font>");
  return text;
}

// ---- The lists: the main window's panel and the window's, drawn alike

// The lists there are: the panel's, and the window's once it has been shown
function eventsLists()
{
  const lists = [];
  if (typeof eventsListMain != "undefined") lists.push(eventsListMain);
  const handle = GT.eventsWindowHandle;
  if (handle && GT.eventsWindowInitialized && GT.eventsWindowEverShown)
  {
    try
    {
      const list = handle.window.document.getElementById("eventsList");
      if (list) lists.push(list);
    }
    catch (e)
    {
      // The window is going away
    }
  }
  return lists;
}

// Every list again: forced (an event came, added: that one) or only where the rows no longer cover the view (a scroll); and the control
// panel's events (View As Waterfall): a new one added on top, else drawn again when forced
function eventsRedraw(force, added = null)
{
  for (const list of eventsLists()) eventsDraw(list, force);
  if (added) eventsPanelAdd(added);
  else if (force) eventsPanelDraw();
}

// A list's scroll redraws it (once per frame), and so does its window's resize (the Event column wraps to the new width)
function eventsHook(list)
{
  if (list.eventsHooked) return;
  list.eventsHooked = true;
  const redraw = (force) =>
  {
    const v = list.eventsView;
    if (!v || v.queued) return;
    v.queued = true;
    list.ownerDocument.defaultView.requestAnimationFrame(() =>
    {
      v.queued = false;
      eventsDraw(list, force);
    });
  };
  list.addEventListener("scroll", () => redraw(false), { passive: true });
  list.ownerDocument.defaultView.addEventListener("resize", () => redraw(true));
  // A right click on the list moves the viewer between the main window and a window of its own
  list.addEventListener("contextmenu", (event) =>
  {
    event.preventDefault();
    eventViewerSetMode(GT.settings.app.eventViewer == "window" ? "main" : "window", true);
  });
}

// The Event column's width in a list, in px: the rest of the row after the time and source columns, their gaps and the row's padding
function eventsTextColumnWidth(list)
{
  const W = GT.eventsWidths;
  return Math.max(80, list.clientWidth - 8 - (W.time + 8) - (W.source + 8) - 16);
}

// A row's height in a list whose Event column is this wide: as drawn there, or reckoned from its text's width until it has been
function eventsRowHeight(event, textColumn)
{
  const drawn = event.heights && event.heights[textColumn];
  if (drawn) return drawn;
  const lines = Math.max(1, Math.ceil((event.textWidth || 0) / textColumn));
  return EVENTS_ROW + (lines - 1) * EVENTS_LINE;
}

// The rows in view, a spacer standing in for the rest above and below, under a header kept at the top. A hidden list is left for when
// it is shown (stale)
function eventsDraw(list, force)
{
  const v = list.eventsView || (list.eventsView = { first: -1, last: -1, queued: false, stale: true });
  eventsHook(list);
  if (list.offsetParent === null)
  {
    v.stale = true;
    return;
  }
  if (v.stale)
  {
    force = true;
    v.stale = false;
    eventsApplyWidths(list);
  }
  const count = GT.events.length;
  const height = list.clientHeight || 300;
  // Each row's top, and the whole list's height
  const textColumn = eventsTextColumnWidth(list);
  const tops = new Array(count + 1);
  tops[0] = 0;
  for (let i = 0; i < count; i++) tops[i + 1] = tops[i] + eventsRowHeight(GT.events[i], textColumn);
  // The first row whose bottom is below the top of the view, and the first whose top is below its bottom (the header's row aside)
  const rowAt = (y) =>
  {
    let low = 0;
    let high = count;
    while (low < high)
    {
      const mid = (low + high) >> 1;
      if (tops[mid + 1] <= y) low = mid + 1;
      else high = mid;
    }
    return low;
  };
  const shownFirst = rowAt(list.scrollTop);
  const shownLast = Math.min(count, rowAt(list.scrollTop + height) + 1);
  if (!force && shownFirst >= v.first && shownLast <= v.last) return;

  const first = Math.max(0, shownFirst - EVENTS_BUFFER);
  const last = Math.min(count, shownLast + EVENTS_BUFFER);
  v.first = first;
  v.last = last;
  const doc = list.ownerDocument;
  const spacer = (px) =>
  {
    const div = doc.createElement("div");
    div.style.height = px + "px";
    return div;
  };
  const row = (cells, head) =>
  {
    const div = doc.createElement("div");
    div.className = "eventRow" + (head ? " eventHead" : "");
    for (const [cls, html] of cells)
    {
      const span = doc.createElement("span");
      span.className = cls;
      span.innerHTML = html;
      div.appendChild(span);
    }
    return div;
  };
  // The header: Event with how many events there are (dim), Clear at the far right of its column, which reaches the list's right edge
  // (and Clear stays in view when the columns are wider than the window: style.css); in the main window's panel, which has no title
  // bar, its X after Clear (the header is the panel's handle too: eventViewerDragInit)
  const head = row([["eventTime", I18N("events.time.label")], ["eventSource", I18N("events.source.label")], ["eventText", I18N("events.text.label") + " <span class='eventCount'>" + count + "</span>"]], true);
  const clear = doc.createElement("span");
  clear.className = "button birdTleButton eventHeadClear";
  clear.textContent = I18N("events.clear.label");
  clear.onclick = () => eventsClear();
  head.lastElementChild.appendChild(clear);
  if (typeof eventsListMain != "undefined" && list === eventsListMain)
  {
    const x = doc.createElement("button");
    x.className = "Xbutton eventHeadClose";
    x.textContent = "X";
    x.onclick = () => closeEventViewer();
    head.lastElementChild.appendChild(x);
  }
  const nodes = [head];
  if (first > 0) nodes.push(spacer(tops[first]));
  const rows = [];
  for (let i = first; i < last; i++)
  {
    const e = GT.events[i];
    const div = row([["eventTime", eventsTimeString(e.time)], ["eventSource", htmlEntities(eventsSourceName(e.source))], ["eventText", eventsRowHtml(e)]], false);
    rows.push([e, div]);
    nodes.push(div);
  }
  if (last < count) nodes.push(spacer(tops[count] - tops[last]));
  list.replaceChildren(...nodes);
  // The rows drawn, their heights kept (the wrap as it came out); where one differs from what was reckoned, the spacers are put right
  let changed = false;
  for (const [e, div] of rows)
  {
    const drawn = div.offsetHeight;
    if (!drawn) continue;
    if (drawn != eventsRowHeight(e, textColumn)) changed = true;
    // A few widths kept (the panel's, the window's), not every one a resize went through
    if (!e.heights || (!(textColumn in e.heights) && Object.keys(e.heights).length >= 4)) e.heights = {};
    e.heights[textColumn] = drawn;
  }
  if (changed && !v.remeasured)
  {
    v.remeasured = true;
    eventsDraw(list, true);
  }
  v.remeasured = false;
}

// ---- The main window's panel: a panel like Settings (one of Settings, BirdWatch's settings, the hot keys and this is open)

function eventViewerShowMain()
{
  rootSettingsDiv.style.display = "none";
  helpDiv.style.display = "none";
  GT.helpShow = false;
  eventViewerDiv.style.display = "inline-flex";
  eventViewerDragInit();
  eventViewerPlace();
  eventsDraw(eventsListMain, true);
}

// ---- The panel can be dragged by its title bar, and comes up where it was left (settings.app.eventViewerPos); until it is dragged it
// sits where the other panels do (in the page's flow, at the top)

// The panel where it was left, kept on screen: its title bar always in view, and its height no more than what is left under it
function eventViewerPlace()
{
  const pos = GT.settings.app.eventViewerPos;
  const panel = eventViewerDiv;
  // The panel's own style has it relative, in the flow, as the other panels: absolute once dragged
  if (!pos)
  {
    panel.classList.remove("eventViewerMoved");
    panel.style.position = "relative";
    panel.style.left = panel.style.top = panel.style.maxHeight = "";
    eventsListMain.style.maxHeight = "";
    eventViewerApplySize();
    return;
  }
  panel.classList.add("eventViewerMoved");
  panel.style.position = "absolute";
  const x = Math.max(0, Math.min(Number(pos.x) || 0, window.innerWidth - panel.offsetWidth));
  const y = Math.max(0, Math.min(Number(pos.y) || 0, window.innerHeight - 40));
  panel.style.left = x + "px";
  panel.style.top = y + "px";
  panel.style.maxHeight = (window.innerHeight - y - 2) + "px";
  // Ten rows (style.css), or fewer where the screen ends; a panel the user sized, its list fills it
  eventsListMain.style.maxHeight = GT.settings.app.eventViewerSize ? "" : Math.min(222, window.innerHeight - y - 36) + "px";
  eventViewerApplySize();
}

// The size the user gave the panel (its corner dragged: settings.app.eventViewerSize), kept within the window from where it is; none,
// it fits its columns and ten rows
function eventViewerApplySize()
{
  const panel = eventViewerDiv;
  const size = GT.settings.app.eventViewerSize;
  panel.classList.toggle("eventViewerSized", !!size);
  if (!size)
  {
    GT.eventViewerSetSize = null;
    panel.style.width = panel.style.height = "";
    return;
  }
  const rect = panel.getBoundingClientRect();
  const w = Math.round(Math.max(320, Math.min(Number(size.w) || 320, window.innerWidth - rect.left - 2)));
  const h = Math.round(Math.max(100, Math.min(Number(size.h) || 100, window.innerHeight - rect.top - 2)));
  // What is set here isn't taken for the user's resize (eventViewerDragInit's observer)
  GT.eventViewerSetSize = { w, h };
  panel.style.width = w + "px";
  panel.style.height = h + "px";
}

// (Dragged by its list's header, which has no title bar above it: the header is drawn again with the list, so the list holds the drag.
// Dropped on the right panel, it goes there as a box of its own, View As Waterfall: the panel outlined while it's over it)
function eventViewerDragInit()
{
  if (GT.eventViewerDragHooked) return;
  GT.eventViewerDragHooked = true;
  const bar = eventsListMain;
  let drag = null;
  bar.addEventListener("pointerdown", (event) =>
  {
    // Only on the header, and not from Clear or the X
    if (event.button != 0 || !event.target.closest(".eventHead") || event.target.closest("button, .button")) return;
    const rect = eventViewerDiv.getBoundingClientRect();
    // (where it was, kept for it if it's dropped on the right panel; where the press was, so a click without a drag changes nothing)
    drag = { dx: event.clientX - rect.left, dy: event.clientY - rect.top, was: GT.settings.app.eventViewerPos, x: event.clientX, y: event.clientY, rect: rect, moved: false };
    try { bar.setPointerCapture(event.pointerId); } catch (e) { /* a synthetic event */ }
    event.preventDefault();
  });
  bar.addEventListener("pointermove", (event) =>
  {
    if (!drag) return;
    if (!drag.moved)
    {
      if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < EVENTS_DRAG_MIN_PX) return;
      drag.moved = true;
      // Taken out of the flow where it is, as the drag starts, so it doesn't jump
      GT.settings.app.eventViewerPos = { x: drag.rect.left, y: drag.rect.top };
      eventViewerPlace();
    }
    GT.settings.app.eventViewerPos = { x: event.clientX - drag.dx, y: event.clientY - drag.dy };
    eventViewerPlace();
    menuDiv.classList.toggle("eventsDropTarget", eventsOverControlPanel(event));
  });
  const done = (event) =>
  {
    if (!drag) return;
    const was = drag.was, moved = drag.moved;
    drag = null;
    try { bar.releasePointerCapture(event.pointerId); } catch (e) { /* not captured */ }
    menuDiv.classList.remove("eventsDropTarget");
    // Dropped on the right panel, after a real drag: in it from now on (the panel's place where it was before this drag)
    if (event.type == "pointerup" && moved && eventsOverControlPanel(event))
    {
      GT.settings.app.eventViewerPos = was;
      eventViewerSetMode("panel", true);
      return;
    }
    // (a click: nothing moved, nothing kept)
    if (!moved) return;
    // Kept as placed (clamped)
    GT.settings.app.eventViewerPos = { x: parseInt(eventViewerDiv.style.left) || 0, y: parseInt(eventViewerDiv.style.top) || 0 };
  };
  bar.addEventListener("pointerup", done);
  bar.addEventListener("pointercancel", done);
  // The panel's corner dragged (the browser sets its width and height): the size kept, the list filling it and wrapped to it
  new MutationObserver(() =>
  {
    const w = parseInt(eventViewerDiv.style.width);
    const h = parseInt(eventViewerDiv.style.height);
    const set = GT.eventViewerSetSize;
    if (!w || !h || (set && set.w == w && set.h == h)) return;
    GT.settings.app.eventViewerSize = { w, h };
    GT.eventViewerSetSize = { w, h };
    eventViewerDiv.classList.add("eventViewerSized");
    eventsListMain.style.maxHeight = "";
    eventsDraw(eventsListMain, true);
  }).observe(eventViewerDiv, { attributes: true, attributeFilter: ["style"] });
  // A smaller window: the panel kept on screen
  window.addEventListener("resize", () =>
  {
    if (eventViewerDiv.style.display == "inline-flex" && GT.settings.app.eventViewerPos) eventViewerPlace();
  });
}

function closeEventViewer()
{
  if (typeof eventViewerDiv != "undefined") eventViewerDiv.style.display = "none";
}

// The time's form changed (local or UTC, toggleTime): the time column measured again and every list redrawn
// An event's time, without its date: HH:MM:SS UTC, or HH:MM:SS local while GridTracker's clock shows local time (its click, toggleTime)
function eventsTimeString(ms)
{
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, "0");
  if (GT.settings.app.useLocalTime == 1) return pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds());
  return pad(d.getUTCHours()) + ":" + pad(d.getUTCMinutes()) + ":" + pad(d.getUTCSeconds()) + " UTC";
}

function eventsTimeFormatChanged()
{
  eventsMeasure(null, true);
  eventsRedraw(true);
}

// Clear, on either list's header: every event is let go
function eventsClear()
{
  GT.events = [];
  eventsMeasure(null, true);
  eventsRedraw(true);
}

// ---- The window of its own (gt_events.html): made hidden at startup, so the main process has put it where it was saved (and shown it,
// when it was open at exit) before it is first shown; then shown, hidden or toggled as asked

function eventsWindowOpen(show = true)
{
  if (GT.eventsWindowHandle == null)
  {
    // The page tells when it is ready (eventsWindowReady), and when the main process has placed it (eventsWindowPlaced)
    GT.eventsWindowShowPending = show;
    GT.eventsWindowHandle = window.open("gt_events.html", "gt_events");
  }
  else if (GT.eventsWindowInitialized)
  {
    if (show)
    {
      GT.eventsWindowEverShown = true;
      eventsRedraw(true);
      electron.ipcRenderer.send("showWin", "gt_events");
    }
    else electron.ipcRenderer.send("hideWin", "gt_events");
  }
  else if (show) GT.eventsWindowShowPending = true;
}

// From the window's page once it has loaded
function eventsWindowReady()
{
  GT.eventsWindowInitialized = true;
  if (!GT.eventsWindowShowPending) return;
  GT.eventsWindowShowPending = false;
  eventsWindowOpen(true);
}

// From the window's page once the main process has placed it: shown by it (it was open at exit), the list is filled in
function eventsWindowPlaced(visible)
{
  if (!visible || GT.eventsWindowEverShown) return;
  GT.eventsWindowEverShown = true;
  eventsRedraw(true);
}

// The Event Viewer button: shown or hidden where it is set to be (a right click sets that)
function toggleEventViewer()
{
  if (GT.settings.app.eventViewer == "panel")
  {
    eventsPanelShow(eventsPanelBox.style.display == "none");
    return;
  }
  if (GT.settings.app.eventViewer == "window")
  {
    closeEventViewer();
    if (!GT.eventsWindowInitialized)
    {
      eventsWindowOpen(true);
      return;
    }
    GT.eventsWindowEverShown = true;
    eventsRedraw(true);
    electron.ipcRenderer.send("toggleWin", "gt_events");
    return;
  }
  if (eventViewerDiv.style.display == "inline-flex") closeEventViewer();
  else
  {
    eventsWindowOpen(false);
    eventViewerShowMain();
  }
}

// A right click on the button (or on the right panel's box): View In Main, View As Window or View As Waterfall; the viewer moves to what is
// chosen
function eventViewerMenu(event)
{
  event.preventDefault();
  const current = ["window", "panel"].includes(GT.settings.app.eventViewer) ? GT.settings.app.eventViewer : "main";
  // (open now where it is: the main window's panel, or the right panel's box)
  const shown = eventViewerDiv.style.display == "inline-flex" || eventsPanelBox.style.display != "none";
  const menu = new Menu();
  // On the events in the control panel (View As Waterfall), which have no header with Clear: Clear first, a divider under it
  if (event.target && event.target.closest && event.target.closest("#eventsPanelList"))
  {
    menu.append(new MenuItem({ label: I18N("events.clear.label"), click: () => eventsClear() }));
    menu.append(new MenuItem({ type: "separator" }));
  }
  for (const [mode, key] of [["main", "events.menu.main.label"], ["window", "events.menu.window.label"], ["panel", "events.menu.panel.label"]])
  {
    menu.append(new MenuItem({
      label: I18N(key),
      type: "radio",
      checked: current == mode,
      click: () => eventViewerSetMode(mode, shown)
    }));
  }
  menu.popup();
}

// Where the viewer shows: "main" (the main window's panel), "window", or "panel" (a box in the right panel); it moves there. shown: it
// was open (to the window: it opens there; to the main window or the right panel it always opens, from the window or a menu)
function eventViewerSetMode(mode, shown)
{
  if (GT.settings.app.eventViewer == mode) return;
  GT.settings.app.eventViewer = mode;
  if (mode == "window")
  {
    closeEventViewer();
    eventsPanelShow(false);
    if (shown) eventsWindowOpen(true);
  }
  else if (mode == "panel")
  {
    closeEventViewer();
    eventsWindowOpen(false);
    eventsPanelShow(true);
  }
  else
  {
    eventsPanelShow(false);
    eventsWindowOpen(false);
    eventViewerShowMain();
  }
}

// ---- In the control panel (View As Waterfall): under its boxes, always last (not one of the boxes dragged about), a line across the
// panel's width above it, then each event's text only, the newest on top, centered (wrapped where it needs more than a line). The panel
// then takes the window's full height and the map stops beside it (updateLayout, either side); the events take the rest of its height,
// at least EVENTS_PANEL_MIN of the window's. The line dragged out over the map puts the Event Viewer back there (View In Main), where
// it's dropped; nowhere else in the panel. Always shown in this view: the Event Viewer button is hidden meanwhile (a right click on the
// events has its menu)

// The most events drawn in it (the newest; the Event Viewer's panel and window list them all), and its least height (of the window's:
// with less room than that under the boxes, its bottom is cut off)
const EVENTS_PANEL_ROWS = 200;
const EVENTS_PANEL_MIN = 0.1;
// How far (px) the pointer must move before a press on the viewer's header or the line is a drag (a click never moves the viewer)
const EVENTS_DRAG_MIN_PX = 5;

// Whether the pointer of a drag is over the control panel (shown): where the Event Viewer docks, and what its line is dragged out of
function eventsOverControlPanel(event)
{
  if (menuDiv.style.display == "none") return false;
  const r = menuDiv.getBoundingClientRect();
  return event.clientX >= r.left && event.clientX <= r.right && event.clientY >= r.top && event.clientY <= r.bottom;
}

// Whether the events are in the control panel and shown (the panel then full height, the map beside it: updateLayout)
function eventsPanelDocked()
{
  return GT.settings.app.eventViewer == "panel" && typeof eventsPanelBox != "undefined" && eventsPanelBox.style.display != "none";
}

// At startup: shown when it's where the Event Viewer is set to be
function eventsPanelInit()
{
  if (GT.settings.app.eventViewer == "panel") eventsPanelShow(true);
  window.addEventListener("resize", () => eventsPanelFit());
  // (anything above it in the control panel changing height: the status lines, the rig's line as it connects, the boxes, BirdWatch's)
  const observer = new ResizeObserver(() => eventsPanelFit());
  for (const el of menuDiv.children) if (el !== eventsPanelBox) observer.observe(el);
  // (and the control panel's own height: full height docked, as tall as it needs otherwise)
  observer.observe(menuDiv);
  eventsPanelRuleInit();
}

// Shown (in this view) or not, when that changes; the Event Viewer button hidden while it is (nothing for it to do: the events are
// always there)
function eventsPanelShow(show)
{
  // (the button set every time, so it can't stay hidden by mistake)
  eventsButton.style.display = show ? "none" : "";
  if ((eventsPanelBox.style.display != "none") == show) return;
  eventsPanelBox.style.display = show ? "" : "none";
  // (the panel full height and the map beside it, or back over the map)
  if (GT.map) updateLayout(GT.menuShowing == false);
  if (show) eventsPanelDraw();
}

// One event's row, centered (its time and source on hover)
function eventsPanelRow(e)
{
  const row = document.createElement("div");
  row.className = "eventsPanelRow";
  row.title = eventsTimeString(e.time) + " · " + eventsSourceName(e.source);
  row.innerHTML = eventsRowHtml(e);
  return row;
}

// The calls highlighted in the rows (eventsRowHtml: your call, the DX call), as the rows drawn last had them
function eventsPanelCalls()
{
  return (GT.localDXcall || "") + "|" + (GT.settings.app.myRawCall || "");
}

// Every row again (shown, Clear, the time's form changed, the calls highlighted changed)
function eventsPanelDraw()
{
  if (typeof eventsPanelBox == "undefined" || eventsPanelBox.style.display == "none") return;
  eventsPanelList.replaceChildren(...GT.events.slice(0, EVENTS_PANEL_ROWS).map(eventsPanelRow));
  eventsPanelList.dataset.calls = eventsPanelCalls();
  eventsPanelFit();
}

// An event come: its row on top, those past EVENTS_PANEL_ROWS (or older than a day: eventsPrune let them go) taken off the bottom. The
// DX call or your call changed since: every row drawn again, so their highlights follow
function eventsPanelAdd(e)
{
  if (typeof eventsPanelBox == "undefined" || eventsPanelBox.style.display == "none") return;
  if (eventsPanelList.dataset.calls != eventsPanelCalls())
  {
    eventsPanelDraw();
    return;
  }
  eventsPanelList.prepend(eventsPanelRow(e));
  const keep = Math.min(EVENTS_PANEL_ROWS, GT.events.length);
  while (eventsPanelList.children.length > keep) eventsPanelList.lastElementChild.remove();
}

// Its list from under the line to the control panel's bottom, at least EVENTS_PANEL_MIN of the window's height: with less room, its
// bottom is cut off (neither it nor the control panel scrolls: updateLayout, style.css)
function eventsPanelFit()
{
  if (typeof eventsPanelBox == "undefined" || eventsPanelBox.style.display == "none") return;
  // (a scroll left from before docking, or from focus, put back)
  if (menuDiv.scrollTop) menuDiv.scrollTop = 0;
  if (eventsPanelList.scrollTop) eventsPanelList.scrollTop = 0;
  const top = eventsPanelList.getBoundingClientRect().top - menuDiv.getBoundingClientRect().top;
  const value = Math.floor(Math.max(window.innerHeight * EVENTS_PANEL_MIN, menuDiv.clientHeight - top - 2)) + "px";
  if (eventsPanelList.style.height != value) eventsPanelList.style.height = value;
}

// The line above the events: dragged out of the control panel (over the map), the Event Viewer goes back over the map where it's let go
// (View In Main); let go in the panel, or a click without a drag, nothing changes. The panel outlined while the line is over it
function eventsPanelRuleInit()
{
  const rule = eventsPanelRule;
  let drag = null;
  rule.addEventListener("pointerdown", (e) =>
  {
    if (e.button != 0) return;
    drag = { x: e.clientX, y: e.clientY, moved: false };
    try { rule.setPointerCapture(e.pointerId); } catch (x) { /* a synthetic event */ }
    e.preventDefault();
  });
  rule.addEventListener("pointermove", (e) =>
  {
    if (!drag) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < EVENTS_DRAG_MIN_PX) return;
    drag.moved = true;
    menuDiv.classList.toggle("eventsDropTarget", eventsOverControlPanel(e));
  });
  const done = (e) =>
  {
    if (!drag) return;
    const moved = drag.moved;
    drag = null;
    try { rule.releasePointerCapture(e.pointerId); } catch (x) { /* not captured */ }
    menuDiv.classList.remove("eventsDropTarget");
    if (e.type != "pointerup" || !moved || eventsOverControlPanel(e)) return;
    // (its header where it was let go)
    GT.settings.app.eventViewerPos = { x: Math.max(0, e.clientX - 40), y: Math.max(0, e.clientY - 10) };
    eventViewerSetMode("main", true);
  };
  rule.addEventListener("pointerup", done);
  rule.addEventListener("pointercancel", done);
}
