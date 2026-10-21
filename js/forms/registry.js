// Form registry: form_key (= survey_type) -> module. Phase C adds the other forms here; they reuse
// components.js (tank rows, signatures, photos, LOP, review) and engine.js.
const FORMS = {
  bunker_delivery_survey: () => import('./bunker_delivery.js'),
  // bunker_quantity_survey: () => import('./b221.js'),          // phase C
  // on_hire_bunker / off_hire_bunker: () => import('./bunker.js'), // phase C
  // on_hire_bc / off_hire_bc: () => import('./bc.js'),            // phase C
  // on_hire_condition / off_hire_condition: () => import('./condition.js'), // phase C
};
export const isSupported = (key) => !!FORMS[key];
export async function loadForm(key) {
  const f = FORMS[key];
  if (!f) return null;
  return Object.assign({}, await f()); // plain object: the engine attaches render/markSaved/nextId
}
