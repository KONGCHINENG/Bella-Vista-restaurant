/* ==========================================================================
   BELLA VISTA — SHARED APP LOGIC
   Loaded by every page. Handles: talking to the API, remembering who's
   logged in, rendering the nav bar to match that state, and toast messages.
   ========================================================================== */

// Change this one line when you deploy your backend somewhere other than
// your own computer (e.g. to your live Render URL).
const API_BASE = 'http://localhost:3000';

// The restaurant's own timezone — used to DISPLAY every stored reservation
// time consistently, regardless of which timezone the viewer's browser is
// in. Must match RESTAURANT_TZ in server.js, which uses it to interpret
// incoming booking times the same way regardless of where the server runs.
// Change both if Bella Vista is ever somewhere other than New York.
const RESTAURANT_TZ = 'America/New_York';

/* ---------- Table metadata ----------
   The database only knows tableNumber and seats — this descriptive text
   is presentation-only, so it lives here rather than in the schema.
   Shared by book.html's dropdown and availability.html's floor view.
   `photo` is the actual filename in the project root — tables 1&2 and 3&4
   share one photo each, so their entries intentionally point to the same
   file. */
const TABLE_INFO = {
	1: { location: 'Window', photo: 'table_1&2.jpg' },
	2: { location: 'Window', photo: 'table_1&2.jpg' },
	3: { location: 'Center', photo: 'table_3&4.jpg' },
	4: { location: 'Center', photo: 'table_3&4.jpg' },
	5: { location: 'Private booth', photo: 'table_5.jpg' }
};

/* ---------- Token helpers ----------
   Customer and admin sessions are stored under SEPARATE localStorage keys.
   They used to share one 'token' key, which meant logging into either flow
   silently overwrote the other's session — an admin refreshing their
   dashboard after a customer login (even in another tab of the same
   browser) would read back a customer token and get bounced to the
   customer site. Separate keys let both sessions coexist independently.
   The JWT itself is the source of truth for who's logged in — we don't
   keep a separate "logged in" flag that could drift out of sync with it. */
function getCustomerToken(){ return localStorage.getItem('customerToken'); }
function setCustomerToken(token){ localStorage.setItem('customerToken', token); }
function clearCustomerToken(){ localStorage.removeItem('customerToken'); }

function getAdminToken(){ return localStorage.getItem('adminToken'); }
function setAdminToken(token){ localStorage.setItem('adminToken', token); }
function clearAdminToken(){ localStorage.removeItem('adminToken'); }

function decodeToken(token){
	if (!token) return null;
	try{
		// A JWT is three base64 sections separated by dots; the middle one
		// is the payload — decoding it locally doesn't require a network call.
		const payload = JSON.parse(atob(token.split('.')[1]));
		if (payload.exp && Date.now() >= payload.exp * 1000) return null; // expired
		return payload; // { id, role, iat, exp }
	}catch{
		return null;
	}
}

function getCurrentCustomer(){
	const payload = decodeToken(getCustomerToken());
	if (!payload){ clearCustomerToken(); return null; }
	return payload;
}

function getCurrentAdmin(){
	const payload = decodeToken(getAdminToken());
	if (!payload){ clearAdminToken(); return null; }
	return payload;
}

// Set by renderNav/renderAdminNav so api() knows which session's token to
// send — every page renders one or the other before making any api() calls.
let AUTH_MODE = 'customer';

function logout(mode){
	if (mode === 'admin'){
		clearAdminToken();
		window.location.href = 'admin-login.html';
	}else{
		clearCustomerToken();
		window.location.href = 'index.html';
	}
}

/* ---------- Fetch wrapper ----------
   Centralizes attaching the Authorization header and parsing JSON, so
   every page's fetch calls stay short. */
async function api(path, { method = 'GET', body } = {}){
	const headers = { 'Content-Type': 'application/json' };
	const token = AUTH_MODE === 'admin' ? getAdminToken() : getCustomerToken();
	if (token) headers['Authorization'] = `Bearer ${token}`;

	const response = await fetch(`${API_BASE}${path}`, {
		method,
		headers,
		body: body ? JSON.stringify(body) : undefined
	});

	let data = null;
	try{ data = await response.json(); }catch{ /* empty body is fine */ }

	if (!response.ok){
		throw new Error((data && data.error) || `Request failed (${response.status})`);
	}
	return data;
}

/* ---------- HTML escaping ----------
   Anything a user or admin typed (names, emails, menu item text) must go
   through this before landing in an innerHTML template string — otherwise
   a signup name like "<img src=x onerror=...>" runs as script for whoever
   views it (e.g. an admin looking at the reservations list). */
function escapeHtml(str){
	return String(str).replace(/[&<>"']/g, (c) => ({
		'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
	}[c]));
}

/* ---------- Toasts ----------
   The one place motion is tied directly to a user action: it appears when
   something just happened (booking confirmed, an error occurred) and
   disappears on its own — never blocking, never demanding a click like
   alert() does. */
function toast(message, type = 'default'){
	let region = document.getElementById('toast-region');
	if (!region){
		region = document.createElement('div');
		region.id = 'toast-region';
		region.setAttribute('role', 'status');
		region.setAttribute('aria-live', 'polite');
		document.body.appendChild(region);
	}
	const el = document.createElement('div');
	el.className = `toast${type !== 'default' ? ` toast--${type}` : ''}`;
	el.textContent = message;
	region.appendChild(el);

	setTimeout(() => {
		el.classList.add('is-leaving');
		el.addEventListener('animationend', () => el.remove(), { once: true });
	}, 3200);
}

/* ---------- Nav bar ----------
   Rendered by script rather than duplicated as static markup in six files,
   so "what links show when logged in as admin" only has to be correct
   in one place. */
function renderNav(activePage){
	const mount = document.getElementById('site-nav');
	if (!mount) return;

	AUTH_MODE = 'customer';
	const user = getCurrentCustomer();
	const links = [];

	links.push({ href: 'index.html', label: 'Home' });
	links.push({ href: 'menu.html', label: 'Menu' });
	links.push({ href: 'availability.html', label: 'Availability' });

	// Customer and admin are two separate flows — this nav is the customer
	// one, so it never links to the admin area (admins land there straight
	// from admin-login.html, and navigate within it via its own top nav).
	if (user){
		links.push({ href: 'book.html', label: 'Book a table' });
		links.push({ href: 'my-bookings.html', label: 'My bookings' });
	}

	const authLink = user
		? `<a href="#" id="logoutLink">Log out</a>`
		: `<a href="login.html">Log in</a><a href="signup.html" class="btn btn--small" style="margin-left:0.5rem;">Book a table</a>`;

	mount.innerHTML = `
		<div class="nav__wrap">
			<a href="index.html" class="nav__brand">Bella <em>Vista</em></a>
			<button class="nav__toggle" id="navToggle" aria-expanded="false" aria-controls="navLinks" aria-label="Toggle menu">
				<span></span><span></span><span></span>
			</button>
			<nav class="nav__links" id="navLinks">
				${links.map(l => `<a href="${l.href}"${l.href === activePage ? ' class="is-active"' : ''}>${l.label}</a>`).join('')}
				${authLink}
			</nav>
		</div>
	`;

	wireNav('customer');
}

// The admin area is a separate flow with its own top nav entirely — not
// the customer nav with an admin link bolted on, and not a second sub-nav
// underneath it. Every admin page is already behind requireAuth({role:
// 'admin'}), so unlike renderNav there's no logged-out state to handle.
function renderAdminNav(activePage){
	const mount = document.getElementById('site-nav');
	if (!mount) return;

	AUTH_MODE = 'admin';
	const links = [
		{ href: 'admin.html', label: 'Dashboard' },
		{ href: 'admin-reservations.html', label: 'Reservations' },
		{ href: 'admin-menu.html', label: 'Menu' },
		{ href: 'admin-users.html', label: 'Customers' }
	];

	mount.innerHTML = `
		<div class="nav__wrap">
			<a href="admin.html" class="nav__brand">Bella <em>Vista</em> <span class="nav__badge">Admin</span></a>
			<button class="nav__toggle" id="navToggle" aria-expanded="false" aria-controls="navLinks" aria-label="Toggle menu">
				<span></span><span></span><span></span>
			</button>
			<nav class="nav__links" id="navLinks">
				${links.map(l => `<a href="${l.href}"${l.href === activePage ? ' class="is-active"' : ''}>${l.label}</a>`).join('')}
				<a href="#" id="logoutLink">Log out</a>
			</nav>
		</div>
	`;

	wireNav('admin');
}

// Shared by renderNav and renderAdminNav — the mobile toggle button and
// logout link work identically in both, just clearing a different token.
function wireNav(mode){
	const toggle = document.getElementById('navToggle');
	const navLinks = document.getElementById('navLinks');
	toggle.addEventListener('click', () => {
		const open = navLinks.classList.toggle('is-open');
		toggle.setAttribute('aria-expanded', String(open));
	});
	navLinks.querySelectorAll('a').forEach(a => {
		a.addEventListener('click', () => navLinks.classList.remove('is-open'));
	});

	const logoutLink = document.getElementById('logoutLink');
	if (logoutLink){
		logoutLink.addEventListener('click', (e) => { e.preventDefault(); logout(mode); });
	}
}

/* ---------- Route guard ----------
   Called at the top of pages that require login (or a specific role).
   Redirects immediately rather than letting a logged-out user see a
   half-loaded protected page. */
function requireAuth({ role } = {}){
	const user = role === 'admin' ? getCurrentAdmin() : getCurrentCustomer();
	if (!user){
		// Customer and admin are separate login flows with separate pages,
		// each backed by its own token — send each to its own login.
		window.location.href = role === 'admin' ? 'admin-login.html' : 'login.html';
		return null;
	}
	return user;
}
