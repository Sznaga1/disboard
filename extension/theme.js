// motyw z ostatniego otwarcia, zanim cokolwiek się narysuje (bez mignięcia domyślnych kolorów)
try {
  const t = localStorage.getItem('disboard.theme');
  if (t && t !== 'disboard') document.documentElement.setAttribute('data-theme', t);
} catch { /* bez pamięci: domyślny motyw */ }
