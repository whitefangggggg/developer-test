// ============================================================
// Launchmen Task API
// Developer Candidate Test — Trial 2
// ============================================================
// Instructions:
//   Run with: npm install && node Test_2_server.js
//   Server starts on: http://localhost:3000
// ============================================================

const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

// Serve static files from the same directory (for the UI)
app.use(express.static(__dirname));

// Root route — serve the task UI directly at http://localhost:3000
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'Test_2_task_ui.html'));
});

const DB_FILE = path.join(__dirname, 'Test_2_tasks.json');

function loadTasks() {
  if (!fs.existsSync(DB_FILE)) return [];
  const raw = fs.readFileSync(DB_FILE, 'utf-8');
  return JSON.parse(raw);
}

function saveTasks(tasks) {
  fs.writeFileSync(DB_FILE, JSON.stringify(tasks, null, 2));
}

// GET /tasks
// Returns all tasks. Supports optional status filter.
app.get('/tasks', (req, res) => {
  const tasks = loadTasks();
  const { status } = req.query;
  if (status) {
    const filtered = tasks.filter(t => t.status === status);
    return res.json({ success: true, tasks: filtered });
  }
  res.json({ success: true, tasks });
});

// POST /tasks
app.post('/tasks', (req, res) => {
  const { title } = req.body;
  // BUG FIX: status was taken directly from req.body and could be undefined.
  // Default to 'pending' so every new task has a valid initial status.
  const status = req.body.status || 'pending';
  const tasks = loadTasks();
  const newTask = {
    id: Date.now(),
    title: title,
    status: status,
  };
  tasks.push(newTask);
  saveTasks(tasks);
  res.status(201).json({ success: true, task: newTask });
});

// PATCH /tasks/:id
app.patch('/tasks/:id', (req, res) => {
  const tasks = loadTasks();
  const { status } = req.body;
  // BUG FIX: req.params.id is a string, but task ids are numbers (Date.now()).
  // Strict equality (===) between a string and a number always returns false,
  // so the task was never found. Parse the param to a number first.
  const task = tasks.find(t => t.id === Number(req.params.id));
  if (!task) {
    return res.status(404).json({ success: false, message: 'Task not found' });
  }
  task.status = status;
  saveTasks(tasks);
  res.json({ success: true, task });
});

// DELETE /tasks/:id
app.delete('/tasks/:id', (req, res) => {
  let tasks = loadTasks();
  // BUG FIX (1): Same type mismatch as PATCH — parse param to number.
  const index = tasks.findIndex(t => t.id === Number(req.params.id));
  // BUG FIX (2): Missing 404 guard — findIndex returns -1 when not found,
  // and splice(-1, 1) would silently delete the last task instead.
  if (index === -1) {
    return res.status(404).json({ success: false, message: 'Task not found' });
  }
  // BUG FIX (3): tasks.splice() returns the *removed* elements, not the
  // remaining array. The old code did `tasks = tasks.splice(index, 1)` which
  // replaced tasks with [deletedTask], then saved that single-item array.
  // splice mutates the original array in-place, so just call it without
  // reassigning and then save the now-shorter tasks array.
  tasks.splice(index, 1);
  saveTasks(tasks);
  res.json({ success: true, message: 'Task deleted' });
});

app.listen(3000, () => {
  console.log('Launchmen Task API running on http://localhost:3000');
});

// ============================================================
// TASK 3 — SQL Performance Review
// ============================================================
//
// QUESTION 1 — Identify the issue
// ---------------------------------------------------------------
// The code has an N+1 query problem.
//
// First it fetches 50 posts with a single query. Then it loops
// over every post and fires a separate SELECT against the authors
// table for each one — up to 50 individual round-trips to the
// database. Each round-trip carries network latency and query
// overhead, so the total cost grows linearly with the number of
// posts (N posts → N+1 queries total). With even modest table
// sizes or a remote DB host, this makes the page visibly slow.
//
// A secondary issue is SQL injection: the author_id is
// interpolated directly into the query string
// (`WHERE id = ${post.author_id}`) instead of using a
// parameterised query, which is a security vulnerability.
//
//
// QUESTION 2 — How to fix it
// ---------------------------------------------------------------
// Replace the loop with a single JOIN query that retrieves posts
// and their author data in one database round-trip:
//
//   const postsWithAuthors = await db.query(
//     `SELECT
//        p.id,
//        p.title,
//        p.created_at,
//        a.id   AS author_id,
//        a.name AS author_name,
//        a.email AS author_email
//      FROM posts p
//      JOIN authors a ON a.id = p.author_id
//      ORDER BY p.created_at DESC
//      LIMIT 50`
//   );
//
//   return postsWithAuthors.map(row => ({
//     id:         row.id,
//     title:      row.title,
//     created_at: row.created_at,
//     author: {
//       id:    row.author_id,
//       name:  row.author_name,
//       email: row.author_email,
//     },
//   }));
//
// This reduces 51 queries (1 + 50) down to exactly 1 query,
// regardless of how many posts are returned.
//
// Adding a covering index on posts(created_at DESC) also helps
// the ORDER BY + LIMIT clause avoid a full table scan:
//
//   CREATE INDEX idx_posts_created_at ON posts(created_at DESC);
//
// ============================================================
