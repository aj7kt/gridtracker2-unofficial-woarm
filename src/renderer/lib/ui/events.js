// GridTracker Copyright © 2026 GridTracker.org
// All rights reserved.
// See LICENSE for more information.

// The Event Viewer: what the control panel's traffic list used to show (QSOs logged, alerts, BirdWatch's announcements, errors...) is
// kept as events, newest first, this session's and never older than a day; nothing is saved to disk. They are shown in the main window
// (a panel like Settings; one of those is open at a time) or in a window of their own (gt_events.html), as the button panel's Event
// Viewer button is set (a right click on it: View In Main / View As Window). A list
// draws only the rows in view (virtual scrolling, like the Satellites lists), and its columns are as wide as the widest row seen, never
// narrower (until Clear)

const EVENTS_KEEP_MS = 24 * 3600 * 1000;
const EVENTS_ROW = 20;
const EVENTS_BUFFER = 8;

// Each { time (ms), source (the key of its name, events.source.<source>), text (html, one line) }
GT.events = [];
// The widest time, source and text seen, in px: the columns' widths, which only grow
GT.eventsWidths = { time: 0, source: 0, text: 0 };

// An event from a part of the app: source "app", "log", "decode", "wsjtx", "roster", "birdwatch", "rotor" or "sota"; html the text
// (html coloring allowed; a message's line breaks become spaces, each row is one height)
function addEvent(source, html)
{
  const now = Date.now();
  const event = { time: now, source: source, text: String(html).replace(/<br\s*\/?>/gi, " ") };
  GT.events.unshift(event);
  eventsPrune(now);
  eventsMeasure(event);
  eventsRedraw(true);
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
    // The Event column's header holds Clear too (its text and padding)
    W.text = width(I18N("events.text.label")) + 10 + width(I18N("events.clear.label")) + 16;
  }
  context.font = "12px Sans-Serif";
  for (const e of force ? GT.events : [event])
  {
    W.time = Math.max(W.time, width(userTimeString(e.time)));
    W.source = Math.max(W.source, width(eventsSourceName(e.source)));
    W.text = Math.max(W.text, width(eventsPlainText(eventsRowHtml(e))));
  }
  for (const list of eventsLists()) eventsApplyWidths(list);
}

function eventsApplyWidths(list)
{
  const W = GT.eventsWidths;
  // A little over what the text needs, for the scaling of text on some screens
  list.style.setProperty("--evTime", W.time + 8 + "px");
  list.style.setProperty("--evSource", W.source + 8 + "px");
  list.style.setProperty("--evText", W.text + 8 + "px");
}

// An event's text as shown: your call in yellow and the DX call in cyan, as the traffic list had them
function eventsRowHtml(event)
{
  let text = event.text;
  if (GT.localDXcall && GT.localDXcall.length > 1) text = text.replaceAll(GT.localDXcall, "<font style='color:cyan'>" + GT.localDXcall + "</font>");
  if (GT.settings.app.myRawCall.length > 1) text = text.replaceAll(GT.settings.app.myRawCall, "<font style='color:yellow'>" + GT.settings.app.myRawCall + "</font>");
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

// Every list again: forced (an event came) or only where the rows no longer cover the view (a scroll)
function eventsRedraw(force)
{
  for (const list of eventsLists()) eventsDraw(list, force);
}

// A list's scroll redraws it (once per frame)
function eventsHook(list)
{
  if (list.eventsHooked) return;
  list.eventsHooked = true;
  list.addEventListener("scroll", () =>
  {
    const v = list.eventsView;
    if (!v || v.queued) return;
    v.queued = true;
    list.ownerDocument.defaultView.requestAnimationFrame(() =>
    {
      v.queued = false;
      eventsDraw(list, false);
    });
  }, { passive: true });
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
  const shownFirst = Math.max(0, Math.min(count, Math.floor(list.scrollTop / EVENTS_ROW)));
  const shownLast = Math.min(count, Math.ceil((list.scrollTop + height) / EVENTS_ROW));
  if (!force && shownFirst >= v.first && shownLast <= v.last) return;

  const first = Math.max(0, shownFirst - EVENTS_BUFFER);
  const last = Math.min(count, shownLast + EVENTS_BUFFER);
  v.first = first;
  v.last = last;
  const doc = list.ownerDocument;
  const spacer = (rows) =>
  {
    const div = doc.createElement("div");
    div.style.height = rows * EVENTS_ROW + "px";
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
  // The header: Clear at the far right of its Event column, which reaches the list's right edge (and Clear stays in view when the
  // columns are wider than the window: style.css)
  const head = row([["eventTime", I18N("events.time.label")], ["eventSource", I18N("events.source.label")], ["eventText", I18N("events.text.label")]], true);
  const clear = doc.createElement("span");
  clear.className = "button birdTleButton eventHeadClear";
  clear.textContent = I18N("events.clear.label");
  clear.onclick = () => eventsClear();
  head.lastElementChild.appendChild(clear);
  const nodes = [head];
  if (first > 0) nodes.push(spacer(first));
  for (let i = first; i < last; i++)
  {
    const e = GT.events[i];
    nodes.push(row([["eventTime", userTimeString(e.time)], ["eventSource", htmlEntities(eventsSourceName(e.source))], ["eventText", eventsRowHtml(e)]], false));
  }
  if (last < count) nodes.push(spacer(count - last));
  list.replaceChildren(...nodes);
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
    return;
  }
  panel.classList.add("eventViewerMoved");
  panel.style.position = "absolute";
  const x = Math.max(0, Math.min(Number(pos.x) || 0, window.innerWidth - panel.offsetWidth));
  const y = Math.max(0, Math.min(Number(pos.y) || 0, window.innerHeight - 40));
  panel.style.left = x + "px";
  panel.style.top = y + "px";
  panel.style.maxHeight = (window.innerHeight - y - 2) + "px";
  // Ten rows (style.css), or fewer where the screen ends
  eventsListMain.style.maxHeight = Math.min(222, window.innerHeight - y - 36) + "px";
}

function eventViewerDragInit()
{
  if (GT.eventViewerDragHooked) return;
  GT.eventViewerDragHooked = true;
  const bar = eventViewerDiv.querySelector(".settingstab");
  let drag = null;
  bar.addEventListener("pointerdown", (event) =>
  {
    // Not from the X: that closes the panel
    if (event.button != 0 || event.target.closest("button, .button")) return;
    const rect = eventViewerDiv.getBoundingClientRect();
    drag = { dx: event.clientX - rect.left, dy: event.clientY - rect.top };
    // Taken out of the flow where it is, so it doesn't jump as the drag starts
    GT.settings.app.eventViewerPos = { x: rect.left, y: rect.top };
    eventViewerPlace();
    try { bar.setPointerCapture(event.pointerId); } catch (e) { /* a synthetic event */ }
    event.preventDefault();
  });
  bar.addEventListener("pointermove", (event) =>
  {
    if (!drag) return;
    GT.settings.app.eventViewerPos = { x: event.clientX - drag.dx, y: event.clientY - drag.dy };
    eventViewerPlace();
  });
  const done = (event) =>
  {
    if (!drag) return;
    drag = null;
    try { bar.releasePointerCapture(event.pointerId); } catch (e) { /* not captured */ }
    // Kept as placed (clamped)
    GT.settings.app.eventViewerPos = { x: parseInt(eventViewerDiv.style.left) || 0, y: parseInt(eventViewerDiv.style.top) || 0 };
  };
  bar.addEventListener("pointerup", done);
  bar.addEventListener("pointercancel", done);
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

// A right click on the button: View In Main or View As Window; the viewer moves to what is chosen
function eventViewerMenu(event)
{
  event.preventDefault();
  const current = GT.settings.app.eventViewer == "window" ? "window" : "main";
  const menu = new Menu();
  for (const [mode, key] of [["main", "events.menu.main.label"], ["window", "events.menu.window.label"]])
  {
    menu.append(new MenuItem({
      label: I18N(key),
      type: "radio",
      checked: current == mode,
      click: () =>
      {
        if (GT.settings.app.eventViewer == mode) return;
        GT.settings.app.eventViewer = mode;
        if (mode == "window")
        {
          const wasOpen = eventViewerDiv.style.display == "inline-flex";
          closeEventViewer();
          if (wasOpen) eventsWindowOpen(true);
        }
        else
        {
          eventsWindowOpen(false);
          eventViewerShowMain();
        }
      }
    }));
  }
  menu.popup();
}
