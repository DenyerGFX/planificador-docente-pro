// js/efemerides.js
// Simple utility to fetch Venezuelan "efemérides" (important dates) from a public API or static JSON.
// This module is optional and can be used to enrich the UI with daily reminders.

export async function obtenerEfemerides(fecha = new Date()) {
  // For now we return a static example; replace with real API later.
  const example = [
    { date: '03-02', description: 'Día de la Mujer Venezolana' },
    { date: '20-04', description: 'Día del Maestro' }
  ];
  // Filter by month-day match
  const mmdd = fecha.toLocaleDateString('en-GB').replace(/\//g, '-');
  return example.filter(e => e.date === mmdd);
}
