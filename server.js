const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');
require('dotenv').config();

const app = express();
const cors = require('cors');
app.use(cors());
const prisma = new PrismaClient();

// Must match RESTAURANT_TZ in app.js. Booking times like "19:00" from the
// client are the restaurant's own wall-clock time, not the server's — without
// this, a naive `new Date("...T19:00:00")` gets parsed in whatever timezone
// the server process happens to run in, which silently shifts every stored
// time whenever the server runs somewhere other than the machine that
// originally handled the booking (e.g. a UTC production host).
const RESTAURANT_TZ = 'America/New_York';

// Converts a naive "YYYY-MM-DDTHH:mm:ss" string — meant as wall-clock time
// in `timeZone` — into the correct UTC Date instant. Works for any date by
// asking Intl what that timezone's actual UTC offset is on that specific
// day (so it stays correct across DST changes) rather than assuming a fixed
// offset.
function zonedTimeToUtc(dateTimeStr, timeZone) {
  const utcGuess = new Date(dateTimeStr.endsWith('Z') ? dateTimeStr : `${dateTimeStr}Z`);

  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false
  });
  const parts = {};
  for (const { type, value } of dtf.formatToParts(utcGuess)) parts[type] = value;

  const asIfLocal = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    parts.hour === '24' ? 0 : Number(parts.hour), Number(parts.minute), Number(parts.second)
  );

  // asIfLocal is what utcGuess's instant looks like when read in `timeZone`;
  // the gap between them is that timezone's current offset from UTC.
  const offset = asIfLocal - utcGuess.getTime();
  return new Date(utcGuess.getTime() - offset);
}

function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ error: 'No token provided' });
  }
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

app.use(express.json());

// Customer signup — Admin accounts are never self-service; there is no
// equivalent /api/admin-signup.
app.post('/api/signup', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    const passwordHash = await bcrypt.hash(password, 10);
    const customer = await prisma.customer.create({
      data: { name, email, passwordHash }
    });
    res.status(201).json({ id: customer.id, name: customer.name, email: customer.email });
  } catch (error) {
    // P2002 = unique constraint violation — this email already has an
    // account. Without this check the customer would see a raw Prisma
    // error message instead of a clear "you already have an account" one.
    if (error.code === 'P2002') {
      return res.status(409).json({ error: 'You have signed up already' });
    }
    res.status(400).json({ error: error.message });
  }
});

// Customer login — checks the Customer table only. Admins use the separate
// /api/admin-login below, which checks the Admin table instead; the two
// never share a query, matching the fact that they're now separate tables.
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const customer = await prisma.customer.findUnique({ where: { email } });
    if (!customer) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    const passwordMatches = await bcrypt.compare(password, customer.passwordHash);
    if (!passwordMatches) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    const token = jwt.sign(
      { id: customer.id, role: 'customer' },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );
    res.json({ token });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Admin login — separate endpoint, separate table, separate page
// (admin-login.html). Not linked from anywhere in the customer nav.
app.post('/api/admin-login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const admin = await prisma.admin.findUnique({ where: { email } });
    if (!admin) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    const passwordMatches = await bcrypt.compare(password, admin.passwordHash);
    if (!passwordMatches) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    const token = jwt.sign(
      { id: admin.id, role: 'admin' },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );
    res.json({ token });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/reservations', authenticate, async (req, res) => {
  try {
    // Admin accounts don't exist in the Customer table at all, so this
    // would fail on the foreign key anyway — this just gives a clear
    // error instead of a raw database one.
    if (req.user.role !== 'customer') {
      return res.status(403).json({ error: 'Only customer accounts can make reservations' });
    }

    const { tableId, date, startTime, endTime } = req.body;
    const start = zonedTimeToUtc(startTime, RESTAURANT_TZ);
    const end = zonedTimeToUtc(endTime, RESTAURANT_TZ);
    const conflict = await prisma.reservation.findFirst({
      where: {
        tableId: Number(tableId),
        date: new Date(date),
        status: { not: 'cancelled' },
        AND: [
          { startTime: { lt: end } },
          { endTime: { gt: start } }
        ]
      }
    });
    if (conflict) {
      return res.status(409).json({ error: 'This table is already booked for that time' });
    }

    // Snapshotting name/email onto the reservation itself (rather than only
    // via the customer relation) means this record still means something if
    // the customer account is ever deleted later.
    const customer = await prisma.customer.findUnique({ where: { id: req.user.id } });
    const reservation = await prisma.reservation.create({
      data: {
        customerId: req.user.id,
        customerName: customer.name,
        customerEmail: customer.email,
        tableId: Number(tableId),
        date: new Date(date),
        startTime: start,
        endTime: end
      }
    });
    res.status(201).json(reservation);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Public — the list of real tables, so pages like book.html's dropdown
// never have to hardcode ids that can drift from what's actually in the
// database (table ids don't necessarily match tableNumber).
app.get('/api/tables', async (req, res) => {
  try {
    const tables = await prisma.table.findMany({ orderBy: { tableNumber: 'asc' } });
    res.json(tables);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Public — lets visitors see which tables are free for a date/time before
// they sign up or log in. Same overlap logic as the booking conflict check.
app.get('/api/availability', async (req, res) => {
  try {
    const { date, startTime, endTime } = req.query;
    if (!date || !startTime || !endTime) {
      return res.status(400).json({ error: 'date, startTime, and endTime are required' });
    }

    const tables = await prisma.table.findMany({ orderBy: { tableNumber: 'asc' } });
    const overlapping = await prisma.reservation.findMany({
      where: {
        date: new Date(date),
        status: { not: 'cancelled' },
        AND: [
          { startTime: { lt: zonedTimeToUtc(endTime, RESTAURANT_TZ) } },
          { endTime: { gt: zonedTimeToUtc(startTime, RESTAURANT_TZ) } }
        ]
      },
      select: { tableId: true }
    });
    const bookedTableIds = new Set(overlapping.map(r => r.tableId));

    res.json(tables.map(t => ({
      id: t.id,
      tableNumber: t.tableNumber,
      seats: t.seats,
      available: !bookedTableIds.has(t.id)
    })));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Public — the live menu, grouped by nothing in particular; menu.html
// groups it into Starters/Mains/Desserts client-side by `category`.
app.get('/api/menu', async (req, res) => {
  try {
    const items = await prisma.menuItem.findMany({ orderBy: [{ category: 'asc' }, { id: 'asc' }] });
    res.json(items);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Admin-only gatekeeper — must be logged in AND have role "admin"
function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admins only' });
  }
  next();
}

// Only an existing admin can create another one — there is no public
// admin-signup endpoint, unlike customer signup.
app.post('/api/admin/admins', authenticate, requireAdmin, async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: 'name is required' });
    }
    if (!password || password.length < 6) {
      return res.status(400).json({ error: 'password must be at least 6 characters' });
    }
    const passwordHash = await bcrypt.hash(password, 10);
    const admin = await prisma.admin.create({
      data: { name: name.trim(), email, passwordHash }
    });
    res.status(201).json({ id: admin.id, name: admin.name, email: admin.email });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

const MENU_CATEGORIES = ['starter', 'main', 'dessert'];

function validateMenuItem(body, { partial = false } = {}) {
  const { category, name, description, price, photo } = body;
  if (!partial || category !== undefined) {
    if (!MENU_CATEGORIES.includes(category)) {
      return 'category must be one of: ' + MENU_CATEGORIES.join(', ');
    }
  }
  if (!partial || name !== undefined) {
    if (!name || !String(name).trim()) return 'name is required';
  }
  if (!partial || description !== undefined) {
    if (!description || !String(description).trim()) return 'description is required';
  }
  if (!partial || price !== undefined) {
    if (!Number.isInteger(Number(price)) || Number(price) <= 0) return 'price must be a positive whole number';
  }
  if (photo !== undefined && photo !== null && typeof photo !== 'string') {
    return 'photo must be a filename or null';
  }
  return null;
}

// Admin creates a new dish
app.post('/api/admin/menu', authenticate, requireAdmin, async (req, res) => {
  try {
    const error = validateMenuItem(req.body);
    if (error) return res.status(400).json({ error });

    const { category, name, description, price, photo } = req.body;
    const item = await prisma.menuItem.create({
      data: { category, name: name.trim(), description: description.trim(), price: Number(price), photo: photo || null }
    });
    res.status(201).json(item);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Admin edits a dish (any subset of fields)
app.put('/api/admin/menu/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const error = validateMenuItem(req.body, { partial: true });
    if (error) return res.status(400).json({ error });

    const { category, name, description, price, photo } = req.body;
    const data = {};
    if (category !== undefined) data.category = category;
    if (name !== undefined) data.name = name.trim();
    if (description !== undefined) data.description = description.trim();
    if (price !== undefined) data.price = Number(price);
    if (photo !== undefined) data.photo = photo || null;

    const item = await prisma.menuItem.update({ where: { id: Number(req.params.id) }, data });
    res.json(item);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Admin removes a dish from the menu
app.delete('/api/admin/menu/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    await prisma.menuItem.delete({ where: { id: Number(req.params.id) } });
    res.status(204).end();
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Admin sees every customer (never the password hash). There's no role to
// manage here anymore — promoting someone to admin now means creating a
// separate Admin row, not flipping a field, so that action doesn't live on
// this endpoint.
app.get('/api/admin/users', authenticate, requireAdmin, async (req, res) => {
  try {
    const customers = await prisma.customer.findMany({
      select: { id: true, name: true, email: true, createdAt: true, _count: { select: { reservations: true } } },
      orderBy: { createdAt: 'desc' }
    });
    res.json(customers);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Admin deletes a customer — blocked only while they have a *pending* or
// *confirmed* reservation (something still to happen). Completed/cancelled
// reservations don't block the delete: the customer row goes away, but
// Reservation.customerId is set to null (onDelete: SetNull in the schema)
// and the reservation itself survives, with its own customerName/
// customerEmail snapshot so the history still means something.
app.delete('/api/admin/users/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const customerId = Number(req.params.id);
    const activeCount = await prisma.reservation.count({
      where: { customerId, status: { in: ['pending', 'confirmed'] } }
    });
    if (activeCount > 0) {
      return res.status(409).json({ error: `This customer has ${activeCount} active reservation(s) and can't be deleted until those are completed or cancelled.` });
    }
    await prisma.customer.delete({ where: { id: customerId } });
    res.status(204).end();
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// A logged-in customer sees only their own bookings
app.get('/api/my-reservations', authenticate, async (req, res) => {
  try {
    const reservations = await prisma.reservation.findMany({
      where: { customerId: req.user.id },
      include: { table: true },
      orderBy: { date: 'asc' }
    });
    res.json(reservations);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Admin sees every reservation from every customer
app.get('/api/admin/reservations', authenticate, requireAdmin, async (req, res) => {
  try {
    const reservations = await prisma.reservation.findMany({
      include: { customer: { select: { id: true, name: true, email: true } }, table: true },
      orderBy: { date: 'asc' }
    });
    res.json(reservations);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});
// Admin updates a reservation's status: confirm a pending booking, mark a
// confirmed one completed once the guest has left, or cancel at any point
// before it's completed. The table becomes bookable for other times the
// moment its reservation is no longer 'pending'/'confirmed' for that
// window — that's automatic (see /api/availability's overlap check) and
// needs no action here; 'completed' exists purely so the list can show
// which bookings are done rather than just no-status-change-forever.
app.patch('/api/admin/reservations/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const { status } = req.body;
    const reservationId = Number(req.params.id);

    const allowedStatuses = ['pending', 'confirmed', 'completed', 'cancelled'];
    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({ error: 'Status must be pending, confirmed, completed, or cancelled' });
    }

    const updated = await prisma.reservation.update({
      where: { id: reservationId },
      data: { status }
    });

    res.json(updated);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));