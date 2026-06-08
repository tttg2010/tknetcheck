// Landing phase: consent + start button.

export function mountLanding({ onStart }) {
  const consent = document.getElementById('consent');
  const btnStart = document.getElementById('btn-start');

  const refresh = () => {
    btnStart.disabled = !consent.checked;
  };

  consent.addEventListener('change', refresh);
  btnStart.addEventListener('click', () => {
    if (consent.checked) onStart();
  });
  refresh();
}
