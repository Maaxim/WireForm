import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

// Real browser geometry checks; run as part of the existing --bulk smoke test.
export async function verifyBulkLayout({ command, evaluate, click, setValue, tab, flush, readProject, output }) {
  const original = await readProject();
  const button = async (label) => {
    await evaluate(`[...document.querySelectorAll('.property-bulk-modal button')].find(e=>e.textContent.trim()===${JSON.stringify(label)}).click()`);
    await flush();
  };
  const measure = () => evaluate(`(()=>{
    const rect=e=>{const r=e.getBoundingClientRect();return {top:r.top,left:r.left,bottom:r.bottom,right:r.right,height:r.height,width:r.width}};
    return [...document.querySelectorAll('[data-bulk-property]')].map(row=>{
      const action=row.querySelector('.property-bulk-controls > select'), value=row.querySelector('.property-bulk-value');
      return {property:row.dataset.bulkProperty,label:rect(row.querySelector(':scope > label')),action:rect(action),
        inputs:[...(value?.querySelectorAll('input,select,textarea')??[])].map(e=>({tag:e.tagName,...rect(e)})),
        error:value?.querySelector('[role="alert"]')?rect(value.querySelector('[role="alert"]')):null};
    });
  })()`);
  for (const category of ["Connectors", "Cables", "Bundles", "Conductors"]) {
    await tab(category);
    await click('.property-editor-table thead input[type="checkbox"]');
    await evaluate(`[...document.querySelectorAll('.property-selection-toolbar button')].find(e=>e.textContent==='Edit Selected').click()`);
    await flush();
    const actions = await evaluate(`[...document.querySelectorAll('.property-bulk-controls > select')].map(e=>e.getAttribute('aria-label'))`);
    assert.ok(actions.length, category);
    for (const action of actions) await setValue(`[aria-label=${JSON.stringify(action)}]`, "set");
    let measurements = await measure();
    for (const row of measurements) {
      assert.ok(row.label.bottom <= row.action.top, `${category}/${row.property}: label above controls`);
      assert.ok(row.inputs.length, `${category}/${row.property}: Set shows editor`);
      assert.ok(Math.abs(row.inputs[0].top - row.action.top) < 1, `${category}/${row.property}: aligned control tops`);
      for (const input of row.inputs) if (input.tag !== "TEXTAREA") assert.equal(input.height, row.action.height, `${row.property}: consistent control heights`);
    }
    if (category === "Bundles") {
      await setValue('.property-bulk-value [aria-label="Numeric value"]', "-0.5");
      const numeric = (await measure()).find(row => row.property === "insulationThicknessMm");
      assert.ok(numeric.error && numeric.error.top >= numeric.inputs[0].bottom, "validation below numeric input");
      assert.equal(numeric.inputs[0].top, numeric.action.top, "validation does not shift controls");
    }
    const screenshot = await command("Page.captureScreenshot", { format: "png" });
    await writeFile(join(output, `bulk-layout-${category.toLowerCase()}.png`), Buffer.from(screenshot.data, "base64"));
    for (const width of [560, 360]) {
      await command("Emulation.setDeviceMetricsOverride", { width, height: 850, deviceScaleFactor: 1, mobile: false });
      await flush(); measurements = await measure();
      for (const row of measurements) {
        assert.ok(row.inputs[0].top >= row.action.bottom, `${category}/${row.property}: narrow controls stack`);
        assert.ok(Math.abs(row.inputs[0].left - row.action.left) < 1 || row.property === "color", "stacked controls share left edge");
      }
      assert.ok(await evaluate(`(()=>{const body=document.querySelector('.property-bulk-body');return body.scrollWidth<=body.clientWidth+1})()`), `${category}: no horizontal overflow at ${width}px`);
      assert.ok(await evaluate(`(()=>{const footer=document.querySelector('.property-bulk-modal > footer').getBoundingClientRect();return footer.bottom<=innerHeight && footer.right<=innerWidth})()`), "footer visible");
    }
    await command("Emulation.setDeviceMetricsOverride", { width: 1700, height: 1050, deviceScaleFactor: 1, mobile: false }); await flush();
    await setValue(`[aria-label=${JSON.stringify(actions[0])}]`, "keep");
    assert.equal(await evaluate(`document.querySelector('.property-bulk-field').querySelector('.property-bulk-value')===null`), true, "Leave unchanged hides editor");
    const clearAvailable = await evaluate(`!document.querySelector('.property-bulk-controls > select option[value="clear"]').disabled`);
    if (clearAvailable) {
      await setValue(`[aria-label=${JSON.stringify(actions[0])}]`, "clear");
      assert.equal(await evaluate(`document.querySelector('.property-bulk-field').querySelector('.property-bulk-value')===null`), true, "Clear hides editor");
    }
    await button("Cancel");
  }
  await tab("Connectors");
  assert.deepEqual(await readProject(), original, "layout interactions do not change project data");
  console.log("Bulk layout passed: all categories and editor types, validation, 1700/560/360px viewports.");
}
