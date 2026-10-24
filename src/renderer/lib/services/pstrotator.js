/**
 * PSTRotator is a third party application (windows-only) that interfaces with dozens of antenna rotators.
 * It offers a way for other apps to request rotation to a specific azimuth, or a grid square.
 *
 * Other rotator control apps, like [CatRotator](https://www.pianetaradio.it/blog/catrotator/) also support this API.
 *
 * The most comprehensive API details are in this Groups.io post:
 *   https://groups.io/g/PstRotator/message/5825
 *
 * It is a protocol of Rotor Control now (Settings -> Features -> Service, rotor.js); the settings it had of its own
 * (settings.pstrotator) are carried over there once (rotorMigrate).
 */

// Aim Rotator: the map's Ctrl-click (mouse.js) and the roster's menu (rosterWindow.js)
function aimRotator(info)
{
  rotorAim(info.callObj);
}
