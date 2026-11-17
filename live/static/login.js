// Página de login da conta F1 TV (servida pelo backend local, mesma origem das rotas /api).
// A senha só sai daqui para o próprio backend, que entra na F1 e guarda apenas o token.
'use strict'

const $ = (id) => document.getElementById(id)

const views = { form: $('form-view'), done: $('done-view'), offline: $('offline-view') }

function show(name) {
  for (const [key, el] of Object.entries(views)) el.hidden = key !== name
}

/** "20/11 às 21:14" no fuso de quem vê. */
function formatExpiry(epoch) {
  const d = new Date(epoch * 1000)
  const two = (n) => String(n).padStart(2, '0')
  return `${two(d.getDate())}/${two(d.getMonth() + 1)} às ${two(d.getHours())}:${two(d.getMinutes())}`
}

function render(account) {
  if (account && account.connected) {
    $('until').textContent = formatExpiry(account.expires)
    show('done')
    $('back').focus()
  } else {
    show('form')
    ;($('email').value ? $('password') : $('email')).focus()
  }
}

function setBusy(busy) {
  const button = $('submit')
  button.disabled = busy
  button.querySelector('.spinner').hidden = !busy
  button.querySelector('span').textContent = busy ? 'Entrando na F1…' : 'Entrar'
  $('email').readOnly = busy
  $('password').readOnly = busy
}

function showError(message) {
  const box = $('error')
  box.textContent = message
  box.hidden = !message
  $('lead').hidden = Boolean(message)
}

async function post(path, body) {
  const resp = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
    cache: 'no-store',
  })
  const data = await resp.json().catch(() => ({}))
  if (!resp.ok) throw new Error(data.error || `Erro ${resp.status} no backend.`)
  return data
}

$('form').addEventListener('submit', async (event) => {
  event.preventDefault()
  const email = $('email').value.trim()
  const password = $('password').value
  if (!email || !password) {
    showError('Preencha o e-mail e a senha.')
    ;(email ? $('password') : $('email')).focus()
    return
  }
  showError('')
  setBusy(true)
  try {
    const account = await post('/api/login', { email, password })
    $('password').value = ''
    render(account)
  } catch (error) {
    $('password').value = ''
    showError(error instanceof TypeError ? 'O backend do apexView não respondeu. Ele continua rodando?' : error.message)
    $('password').focus()
  } finally {
    setBusy(false)
  }
})

$('toggle').addEventListener('click', () => {
  const input = $('password')
  const visible = input.type === 'password'
  input.type = visible ? 'text' : 'password'
  $('toggle').textContent = visible ? 'Ocultar' : 'Mostrar'
  $('toggle').setAttribute('aria-pressed', String(visible))
  input.focus()
})

$('logout').addEventListener('click', async () => {
  try {
    render(await post('/api/logout'))
  } catch (error) {
    alert(error.message)
  }
})

// Aberta pela aba Ao vivo numa aba nova: tenta fechar e voltar a ela; senão, abre o site.
$('back').addEventListener('click', (event) => {
  event.preventDefault()
  const href = $('back').href
  window.close()
  setTimeout(() => window.location.assign(href), 150)
})

fetch('/api/account', { cache: 'no-store' })
  .then((resp) => (resp.ok ? resp.json() : Promise.reject(new Error(String(resp.status)))))
  .then(render)
  .catch(() => show('offline'))
