// GridTracker Copyright © 2026 GridTracker.org
// All rights reserved.
// See LICENSE for more information.

// A panel's boxes in the order the user drags them to: each a child of the panel's container with a data-box name. A box is dragged
// by its top border (within PANEL_BOX_GRAB_PX of its top edge, where the cursor shows a grab hand); a click there stays a click until
// the mouse moves PANEL_BOX_DRAG_PX. A copy of the box follows the mouse while its place in the panel, dimmed, moves to where it would
// drop. The rest of a box is its own. A box marked data-box-fixed (the button grid: its top is its buttons, which drag on their own) is
// not dragged itself, but the others move above and below it

const PANEL_BOX_DRAG_PX = 5;
const PANEL_BOX_GRAB_PX = 6;

// Once for a container: its boxes put in the saved order (names), and dragging them; saveOrder(names) keeps a new order
function panelBoxesInit(container, names, saveOrder)
{
  // The page's order, for Reset Panels (panelBoxesReset)
  container.panelBoxFirst = [...container.children].map((el) => el.dataset.box).filter((name) => name);
  panelBoxesOrder(container, names);
  const P = { container, saveOrder, grab: null };
  container.addEventListener("pointerdown", (e) => panelBoxDown(P, e));
  container.addEventListener("pointermove", (e) => panelBoxHover(P, e));
  container.addEventListener("pointerleave", () => panelBoxHover(P, null));
}

// The boxes put in the order of names (any not in it, a box added since, after the others in the page's order). No names: left as they are
function panelBoxesOrder(container, names)
{
  if (!Array.isArray(names) || names.length == 0) return;
  const boxes = [...container.children].filter((el) => el.dataset.box);
  const rank = (el) =>
  {
    const at = names.indexOf(el.dataset.box);
    return at < 0 ? names.length + boxes.indexOf(el) : at;
  };
  for (const el of boxes.slice().sort((a, b) => rank(a) - rank(b))) container.appendChild(el);
}

// Reset Panels: the boxes back in the page's order; that order's names
function panelBoxesReset(container)
{
  const first = container.panelBoxFirst || [];
  panelBoxesOrder(container, first);
  return first.slice();
}

// The box whose top border (and the few pixels under it) the mouse is on, or null
function panelBoxOnBorder(P, e)
{
  const box = e.target.closest ? e.target.closest("[data-box]") : null;
  if (!box || box.parentElement !== P.container || "boxFixed" in box.dataset) return null;
  return e.clientY - box.getBoundingClientRect().top <= PANEL_BOX_GRAB_PX ? box : null;
}

// The grab hand on a box's top border (not while one is dragged)
function panelBoxHover(P, e)
{
  const box = e && !P.dragging ? panelBoxOnBorder(P, e) : null;
  if (box === P.grab) return;
  if (P.grab) P.grab.classList.remove("panelBoxGrab");
  if (box) box.classList.add("panelBoxGrab");
  P.grab = box;
}

function panelBoxDown(P, e)
{
  if (e.button != 0) return;
  const box = panelBoxOnBorder(P, e);
  if (!box || e.target.closest("input, select, textarea")) return;
  const container = P.container;
  const startY = e.clientY;
  let ghost = null;
  let grabX = 0, grabY = 0;
  const move = (m) =>
  {
    if (!P.dragging)
    {
      if (Math.abs(m.clientY - startY) < PANEL_BOX_DRAG_PX) return;
      P.dragging = true;
      panelBoxHover(P, null);
      const r = box.getBoundingClientRect();
      grabX = e.clientX - r.left;
      grabY = e.clientY - r.top;
      ghost = panelBoxGhost(box, r);
      box.classList.add("panelBoxDragging");
      container.style.userSelect = "none";
      window.getSelection().removeAllRanges();
    }
    ghost.style.left = m.clientX - grabX + "px";
    ghost.style.top = m.clientY - grabY + "px";
    // Before the first shown box whose middle is below the mouse, else last
    const others = [...container.children].filter((el) => el !== box && el.dataset.box && el.offsetParent !== null);
    const before = others.find((el) =>
    {
      const r = el.getBoundingClientRect();
      return m.clientY < r.top + r.height / 2;
    });
    if (before)
    {
      if (box.nextElementSibling !== before) container.insertBefore(box, before);
    }
    else if (container.lastElementChild !== box) container.appendChild(box);
  };
  const up = () =>
  {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", up);
    if (!P.dragging) return;
    P.dragging = false;
    ghost.remove();
    box.classList.remove("panelBoxDragging");
    container.style.userSelect = "";
    P.saveOrder([...container.children].map((el) => el.dataset.box).filter((name) => name));
    // The click that ends a drag isn't one (a box's own click): it comes straight after, in this same turn
    const swallow = (c) =>
    {
      c.stopPropagation();
      c.preventDefault();
    };
    window.addEventListener("click", swallow, { capture: true, once: true });
    setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 0);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", up);
}

// The box being dragged as it looks, under the mouse: a copy with no ids (they stay the box's own, so it is styled by class), its
// canvases' pictures copied in (a copy of a canvas is blank)
function panelBoxGhost(box, r)
{
  const ghost = box.cloneNode(true);
  ghost.removeAttribute("id");
  for (const el of ghost.querySelectorAll("[id]")) el.removeAttribute("id");
  const from = box.querySelectorAll("canvas");
  ghost.querySelectorAll("canvas").forEach((canvas, i) =>
  {
    if (from[i] && from[i].width && from[i].height) canvas.getContext("2d").drawImage(from[i], 0, 0);
  });
  ghost.classList.add("panelBoxGhost");
  Object.assign(ghost.style, { left: r.left + "px", top: r.top + "px", width: r.width + "px", height: r.height + "px", margin: "0" });
  document.body.appendChild(ghost);
  return ghost;
}
