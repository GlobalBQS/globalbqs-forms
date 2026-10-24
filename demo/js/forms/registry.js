export const __v = '1.1.15-20261024-fe444f3a';
// Form registry: form_key (= survey_type) -> form object. All forms share engine.js + components.js
// (tank rows, signatures with the "sign only when the section is complete" rule, photos, LOP, review).
const HIRE_KEYS = ['bunker_quantity_survey', 'on_hire_bunker', 'off_hire_bunker', 'on_hire_bc', 'off_hire_bc', 'on_hire_condition', 'off_hire_condition'];
export const isSupported = (key) => key === 'bunker_delivery_survey' || HIRE_KEYS.includes(key);
export async function loadForm(key) {
  if (key === 'bunker_delivery_survey') return Object.assign({}, await import('./bunker_delivery.js?v=1.1.15-20261024-fe444f3a')); // plain object: the engine attaches render/markSaved/nextId
  if (HIRE_KEYS.includes(key)) return (await import('./hire.js?v=1.1.15-20261024-fe444f3a')).create(key);
  return null;
}
