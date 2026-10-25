// GridTracker Copyright © 2026 GridTracker.org
// All rights reserved.
// See LICENSE for more information.

// Button panel: building it, ordering and drag-and-drop (moved from GridTracker2.js)

function buttonPanelInit()
{
  let iconButtons = buttonsDiv.querySelectorAll(".iconButton");

  for (let i = 0; i < iconButtons.length; i++)
  {
    GT.defaultButtons[i] = iconButtons[i].id;

    iconButtons[i].addEventListener("dragstart", buttonDragStart);
    iconButtons[i].draggable = true;
  }

  // A button grows (1.5 times, style.css) from its middle; from the side by the window's edge when it would go past it
  buttonsDiv.addEventListener("mouseover", (event) =>
  {
    const button = event.target.closest(".iconButton");
    if (!button || button.parentElement !== buttonsDiv) return;
    // Where it is unscaled: the panel's place plus its own in the panel (the panel isn't scaled, the button may be)
    const panel = buttonsDiv.getBoundingClientRect();
    const left = panel.left + button.offsetLeft - buttonsDiv.offsetLeft;
    const top = panel.top + button.offsetTop - buttonsDiv.offsetTop;
    const growX = button.offsetWidth * 0.25;
    const growY = button.offsetHeight * 0.25;
    const x = left + button.offsetWidth + growX > window.innerWidth ? "right" : left - growX < 0 ? "left" : "center";
    const y = top + button.offsetHeight + growY > window.innerHeight ? "bottom" : top - growY < 0 ? "top" : "center";
    button.style.transformOrigin = x + " " + y;
  });

  if (GT.settings.app.buttonPanelOrder.length > 0)
  {
    // First make sure that all the saved buttons exist.
    let i = GT.settings.app.buttonPanelOrder.length;
    while (i--)
    {
      if (document.getElementById(GT.settings.app.buttonPanelOrder[i]) == null)
      {
        GT.settings.app.buttonPanelOrder.splice(i, 1);
      }
    }

    // A button that is new to the saved order goes after the one it follows in the page (BirdWatch's after Satellite Tracking),
    // or at the end when none before it is there
    for (let i = 0; i < GT.defaultButtons.length; i++)
    {
      if (GT.settings.app.buttonPanelOrder.indexOf(GT.defaultButtons[i]) == -1)
      {
        const after = GT.settings.app.buttonPanelOrder.indexOf(GT.defaultButtons[i - 1]);
        if (i > 0 && after != -1) GT.settings.app.buttonPanelOrder.splice(after + 1, 0, GT.defaultButtons[i]);
        else GT.settings.app.buttonPanelOrder.push(GT.defaultButtons[i]);
      }
    }

    setButtonPanelOrder(GT.settings.app.buttonPanelOrder);
  }
  else
  {
    GT.settings.app.buttonPanelOrder = [...GT.defaultButtons];
  }
}

function setButtonPanelOrder(which)
{
  let buttonObjects = {};
  let iconButtons = buttonsDiv.querySelectorAll(".iconButton");

  // Save a point to each button element so we don't destroy it
  for (let i = 0; i < iconButtons.length; i++)
  {
    buttonObjects[iconButtons[i].id] = iconButtons[i];
  }

  // Clear the button panel
  while (buttonsDiv.lastElementChild)
  {
    buttonsDiv.removeChild(buttonsDiv.lastElementChild);
  }

  // Append each button by its order
  for (let i = 0; i < which.length; i++)
  {
    buttonsDiv.appendChild(buttonObjects[which[i]]);
  }
  saveButtonOrder();
}

function buttonDragStart(event)
{
  event.dataTransfer.setData("Button", event.target.id);
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.dropEffect = "move";
}

function onButtonDrop(event)
{
  if (event.target.draggable)
  {
    let dragElement = document.getElementById( event.dataTransfer.getData("Button"));
    // Not one of this panel's buttons (the BirdWatch panel's have their own drop)
    if (!dragElement) return;
    let target = event.target;
    let parent = event.target.parentNode;
    while (parent != buttonsDiv)
    {
      target = parent;
      parent = target.parentNode;
    }

    let movingButton = GT.settings.app.buttonPanelOrder.indexOf(dragElement.id);
    let targetButton = GT.settings.app.buttonPanelOrder.indexOf(target.id);


    if (target.nextElementSibling)
    {
      if (movingButton < targetButton)
      {
        parent.insertBefore(dragElement, target.nextElementSibling);
      }
      else
      {
        parent.insertBefore(dragElement, target);
      }
    }
    else
    {
      parent.appendChild(dragElement);
    }

    saveButtonOrder();
    event.preventDefault();
  }
}

function saveButtonOrder()
{
  let iconButtons = buttonsDiv.querySelectorAll("[class^='iconButton']");
  GT.settings.app.buttonPanelOrder = [];
  for (let i = 0; i < iconButtons.length; i++)
  {
    GT.settings.app.buttonPanelOrder[i] = iconButtons[i].id;
  }
}
