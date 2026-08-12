const fs = require('fs');
const path = require('path');
const USERS_FILE = path.join(__dirname, '../data/users.json');

const defaultUsers = [
  {
    id: "usr-admin-1",
    email: "admin@edulondon.sch.uk",
    password: "admin", // Simple password for demo
    name: "System Admin (Manager)",
    role: "admin",
    createdAt: new Date().toISOString()
  },
  {
    id: "parent-sarah",
    email: "sarah@gmail.com",
    password: "user",
    name: "Sarah Jenkins",
    role: "user",
    createdAt: new Date().toISOString()
  },
  {
    id: "parent-david",
    email: "david@gmail.com",
    password: "user",
    name: "David & Emma Miller",
    role: "user",
    createdAt: new Date().toISOString()
  },
  {
    id: "parent-priya",
    email: "priya@gmail.com",
    password: "user",
    name: "Priya Patel",
    role: "user",
    createdAt: new Date().toISOString()
  }
];

if (!fs.existsSync(USERS_FILE)) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(defaultUsers, null, 2));
  console.log('Created data/users.json with demo accounts');
} else {
  console.log('data/users.json already exists');
}
