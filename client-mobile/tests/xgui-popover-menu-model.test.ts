import assert from "node:assert/strict"
import test from "node:test"

import { calculateXGUIPopoverLayout } from "../src/xgui/components/xgui-popover-menu-model.ts"

const base = {
  anchor: { height: 40, width: 40, x: 300, y: 100 },
  insets: { bottom: 20, left: 0, right: 0, top: 20 },
  menuHeight: 112,
  menuWidth: 220,
  placement: "bottom-end" as const,
  windowHeight: 800,
  windowWidth: 360,
}

test("positions bottom-end against the anchor end", () => {
  assert.deepEqual(calculateXGUIPopoverLayout(base), {
    arrowX: 195,
    menuX: 120,
    menuY: 150,
    placement: "bottom-end",
  })
})

test("clamps a menu to the horizontal screen edge", () => {
  const result = calculateXGUIPopoverLayout({
    ...base,
    anchor: { ...base.anchor, x: 2 },
    placement: "bottom-start",
  })
  assert.equal(result.menuX, 8)
})

test("flips bottom placement when only the top has room", () => {
  const result = calculateXGUIPopoverLayout({
    ...base,
    anchor: { ...base.anchor, y: 700 },
  })
  assert.equal(result.placement, "top-end")
  assert.equal(result.menuY, 578)
})

test("keeps requested top placement when it has room", () => {
  const result = calculateXGUIPopoverLayout({
    ...base,
    anchor: { ...base.anchor, y: 300 },
    placement: "top-start",
  })
  assert.equal(result.placement, "top-start")
  assert.equal(result.menuY, 178)
})

test("clamps the triangle away from menu corners", () => {
  const left = calculateXGUIPopoverLayout({
    ...base,
    anchor: { ...base.anchor, width: 4, x: -20 },
    placement: "bottom-start",
  })
  assert.equal(left.arrowX, 8)

  const right = calculateXGUIPopoverLayout({
    ...base,
    anchor: { ...base.anchor, width: 4, x: 380 },
  })
  assert.equal(right.arrowX, 202)
})

test("aligns a compact header anchor with the triangle center", () => {
  const result = calculateXGUIPopoverLayout({
    ...base,
    anchor: { height: 30, width: 30, x: 347, y: 50 },
    menuWidth: 180,
    windowWidth: 393,
  })
  const anchorCenter = 347 + 30 / 2
  const arrowCenter = result.menuX + result.arrowX + 10 / 2
  assert.equal(arrowCenter, anchorCenter)
})
