# ChargeZone Inventory Management System

ChargeZone Inventory Control is a web-based inventory management system designed for ChargeZone's EV charging station network. It handles material tracking across Head Office (HO) warehouses, regional hubs, and charging sites.

Key workflows include:
- Purchase Order (PO) PDF parsing and manual entry
- Barcode generation and asset tracking
- Inter-region stock movement and site dispatching
- Requisitions (OMS tickets) and fulfillment
- Material installation, faulty component swaps, and disposition handling (repairable, scrap)

---

## Architecture & Tech Stack

- **Frontend**: HTML5, Vanilla JavaScript, CSS3 design system, `html5-qrcode` (camera barcode scanner), `QRCode.js`.
- **Backend**: Node.js, Express, `helmet` (security headers), `express-rate-limit`, JWT authentication, Bcrypt (`bcryptjs`), Multer (file uploads), `pdf-parse`.
- **Database**: PostgreSQL (`pg` connection pool with type parsing).

---

## Getting Started

### Prerequisites
- Node.js v18+
- PostgreSQL v14+
- npm v9+

### 1. Database Setup

Create the PostgreSQL database and load schema and seed data using `psql` CLI:

```bash
createdb chargezone_inventory
psql -d chargezone_inventory -f database/schema.sql
psql -d chargezone_inventory -f database/seed.sql
```

### 2. Backend Setup & Configuration

Create or update `backend/.env`:

```env
PORT=4000
JWT_SECRET=your_jwt_secret_key
DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=your_postgres_password
DB_NAME=chargezone_inventory

# Optional deployment flags
SERVE_FRONTEND=true
CORS_ORIGIN=*
```

Install backend dependencies and run the server:

```bash
cd backend
npm install

# Start development server
npm run dev

# Or start production server
npm start
```

Health check endpoint: `http://localhost:4000/api/health`

### 3. Default Seed Credentials

All pre-seeded test accounts in `database/seed.sql` come pre-configured with the default password: `Admin@123`

- **Super Admin**: `admin@chargezone.com` / `Admin@123`
- **Regional Admins**: `ho.admin@chargezone.com`, `east.admin@chargezone.com`, `west.admin@chargezone.com`, etc. / `Admin@123`
- **Site Engineers**: `east.engineer1@chargezone.com`, `west.engineer1@chargezone.com`, etc. / `Admin@123`

> **Note**: When an Admin creates a new user via the Users panel, the assigned temporary password will trigger a **Set Permanent Password** pop-up box upon that user's initial login. The permanent password is automatically hashed (`bcrypt`) and directly updated in the PostgreSQL database.

### 4. Frontend Setup & Unified Deployment Options

- **Standalone Frontend**: Serve the `frontend` folder using any static file server:
  ```bash
  cd frontend
  npx serve .
  ```
  Open `http://localhost:3000` in your browser.

- **Unified Single-Server Deployment**: Set `SERVE_FRONTEND=true` in `backend/.env` and start the backend:
  ```bash
  cd backend
  npm start
  ```
  Access the complete application at `http://localhost:4000`.

---

## Role-Based Access Control (RBAC)

| Feature | Super Admin (`super_admin`) | Region Admin (`region_admin`) | Site Engineer (`site_engineer`) |
| :--- | :---: | :---: | :---: |
| **Inventory Dashboard** | All Regions | Assigned Region | View Only |
| **Materials Master** | Full Control | Read Only | Read Only |
| **PO PDF Upload & Entry** | Full Control | Manual Entry (Region) | None |
| **Stock Movement** | Full Control | Region Level | Site Receiving & Returns |
| **OMS Requisitions** | Full Control | Manage Region | Create / Cancel Own |
| **Consumptions & Swaps** | Full Control | Full Control | Assigned Site |
| **User Management** | Full Control | Region Engineers | None |

---

## API Summary

- `POST /api/auth/login` - Authenticate user & receive JWT token
- `POST /api/auth/forgot-password` - Password reset
- `GET /api/auth/me` - Authenticated profile details
- `GET /api/health` - Database & server status
- `GET /api/dashboard/summary` - Live inventory metrics
- `GET /api/materials` - Material catalog management
- `GET /api/purchase-orders` - Purchase order listing & parsing
- `GET /api/transactions` - Stock movement ledger
- `GET /api/requisitions` - OMS ticket requisitions
- `GET /api/replacements` - Component swap history
- `GET /api/consumptions` - Site installation logs
- `GET /api/users` - User administrative actions
