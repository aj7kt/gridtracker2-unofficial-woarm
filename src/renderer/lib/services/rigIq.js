// GridTracker Copyright © 2026 GridTracker.org
// All rights reserved.
// See LICENSE for more information.

// The VFOs whose rig also gives its I/Q (an SDR server: SPY Server, rigSpy.js; SDR++ Server, rigSdrpp.js), for the Multi-Mode Decoder's
// Input Device menus. Each such protocol has iq: { name: what it is called in the menus, start(R, minRate, onIq): the rate it will come at
// (null: not known yet, the server not connected), stop(R) }. onIq(samples: Float32Array of I and Q in turn, rate) as it comes, the I/Q
// centred on the VFO's frequency, at least minRate wide (complex samples a second, usable). One listener per rig: a new one takes its place

function rigIqProtocol(v)
{
  const protocol = v && !rigVfoIsSecond(v) ? RIG_PROTOCOLS[v.protocol] : null;
  return protocol && protocol.iq ? protocol : null;
}

function rigIqVfos()
{
  return rigVfos().filter((v) => rigIqProtocol(v));
}

// What a VFO's I/Q is called in the menus: "SPY Server", "SDR++ Server"
function rigIqName(v)
{
  const protocol = rigIqProtocol(v);
  return protocol ? protocol.iq.name : "";
}

// The I/Q of a VFO (its id) started: the rate it will come at, null (not known yet), or false when the VFO gives none
function rigIqStart(vfoId, minRate, onIq)
{
  const v = rigVfoById(vfoId);
  const protocol = rigIqProtocol(v);
  const R = protocol ? GT.rigs[v.id] : null;
  if (!R) return false;
  return protocol.iq.start(R, minRate, onIq);
}

function rigIqStop(vfoId)
{
  const v = rigVfoById(vfoId);
  const protocol = rigIqProtocol(v);
  const R = protocol ? GT.rigs[v.id] : null;
  if (R) protocol.iq.stop(R);
}
