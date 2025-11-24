import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import bcrypt from "bcryptjs";
import mysql from "mysql";

dotenv.config();
const app = express();

// Enhanced CORS configuration
app.use(cors({
  origin: "http://localhost:5173",
  credentials: true
}));

app.use(express.json());

// MySQL connection
const db = mysql.createConnection({
  host: process.env.MYSQL_HOST || 'localhost',
  user: process.env.MYSQL_USER || 'root',
  password: process.env.MYSQL_PASSWORD || '',
  database: process.env.MYSQL_DATABASE || 'abizerwa'
});

// Connect to MySQL
db.connect((err) => {
  if (err) {
    console.error('❌ Database connection failed:', err);
    return;
  }
  console.log('✅ Connected to MySQL database');
});

// Simple session storage for admin (in production use Redis or database sessions)
const adminSessions = new Map();

// ADMIN AUTHENTICATION - SECURED WITH PASSWORD HASHING

// ADMIN SIGNUP - Secure with password hashing
app.post("/api/admin/signup", (req, res) => {
  const { email, telephone, password } = req.body;

  // Validation
  if (!email || !telephone || !password) {
    return res.status(400).json({ message: "Email, telephone na password bya ngombwa!" });
  }

  if (password.length < 6) {
    return res.status(400).json({ message: "Password igomba kuba ifite imibare 6 bya gito!" });
  }

  // Check if admin already exists
  const checkAdmin = "SELECT id FROM admin WHERE email = ?";
  db.query(checkAdmin, [email], (err, results) => {
    if (err) {
      console.error("❌ Database error:", err);
      return res.status(500).json({ message: "Ikosa mu kureba admin!" });
    }

    if (results.length > 0) {
      return res.status(400).json({ message: "Admin account ishashuye!" });
    }

    // Hash password
    bcrypt.hash(password, 12, (hashErr, hashedPassword) => {
      if (hashErr) {
        console.error("❌ Hashing error:", hashErr);
        return res.status(500).json({ message: "Ikosa mu kubika password!" });
      }

      // Create admin
      const INSERT = "INSERT INTO admin (email, telephone, password) VALUES (?, ?, ?)";
      db.query(INSERT, [email, telephone, hashedPassword], (insertErr, result) => {
        if (insertErr) {
          console.error("❌ Database insert error:", insertErr);
          return res.status(500).json({ message: "Ikosa mu kubika admin!" });
        }

        res.status(201).json({
          message: "Admin yanditswe neza!!!",
          admin: { id: result.insertId, email, telephone }
        });
      });
    });
  });
});

// ADMIN LOGIN - Secure with password hashing
app.post("/api/admin/login", (req, res) => {
  const { email, password } = req.body;

  // Validation
  if (!email || !password) {
    return res.status(400).json({ message: "Email na password bya ngombwa!" });
  }

  const login = "SELECT id, email, telephone, password FROM admin WHERE email = ?";
  db.query(login, [email], (err, results) => {
    if (err) {
      console.error("❌ Database error:", err);
      return res.status(500).json({ message: "Ikosa mu kureba admin!" });
    }

    if (results.length === 0) {
      return res.status(400).json({ message: "Email cg password siyo!!" });
    }

    const admin = results[0];

    // Compare hashed password
    bcrypt.compare(password, admin.password, (compareErr, valid) => {
      if (compareErr) {
        console.error("❌ Password comparison error:", compareErr);
        return res.status(500).json({ message: "Ikosa mu kureba password!" });
      }

      if (!valid) {
        return res.status(400).json({ message: "Email cg password siyo!!" });
      }

      // Create simple session
      const sessionId = Date.now().toString() + Math.random().toString(36).substr(2);
      adminSessions.set(sessionId, {
        id: admin.id,
        email: admin.email,
        telephone: admin.telephone
      });

      // Remove password from response for security
      const { password: _, ...adminWithoutPassword } = admin;

      res.status(200).json({
        message: "Winjiye neza admin!!",
        admin: adminWithoutPassword,
        sessionId: sessionId
      });
    });
  });
});

// Middleware to verify admin session
const verifyAdmin = (req, res, next) => {
  const sessionId = req.header('X-Session-ID');
  
  if (!sessionId) {
    return res.status(401).json({ message: "Access denied. No session ID provided." });
  }

  const session = adminSessions.get(sessionId);
  if (!session) {
    return res.status(401).json({ message: "Invalid session. Please login again." });
  }

  req.admin = session;
  next();
};

// GET ADMIN PROFILE (Protected)
app.get("/api/admin/profile", verifyAdmin, (req, res) => {
  const adminId = req.admin.id;
  
  const getQuery = "SELECT id, email, telephone FROM admin WHERE id = ?";
  db.query(getQuery, [adminId], (err, result) => {
    if (err) {
      console.error("❌ Database error:", err);
      return res.status(500).json({ message: "Ikosa mu kubona amakuru ya admin!" });
    }
    
    if (result.length === 0) {
      return res.status(404).json({ message: "Admin account not found!" });
    }
    
    res.status(200).json({ admin: result[0] });
  });
});

// UPDATE ADMIN PROFILE (Protected)
app.put("/api/admin/profile", verifyAdmin, (req, res) => {
  const adminId = req.admin.id;
  const { email, telephone, currentPassword, newPassword } = req.body;

  // Validation
  if (!email || !telephone) {
    return res.status(400).json({ message: "Email na telephone bya ngombwa!" });
  }

  // First, get current admin data
  const getAdminQuery = "SELECT email, telephone, password FROM admin WHERE id = ?";
  db.query(getAdminQuery, [adminId], (err, results) => {
    if (err) {
      console.error("❌ Database error:", err);
      return res.status(500).json({ message: "Ikosa mu kureba admin!" });
    }

    if (results.length === 0) {
      return res.status(404).json({ message: "Admin account not found!" });
    }

    const currentAdmin = results[0];

    // Check if email is being changed and if new email already exists
    if (email !== currentAdmin.email) {
      const checkEmailQuery = "SELECT id FROM admin WHERE email = ? AND id != ?";
      db.query(checkEmailQuery, [email, adminId], (emailErr, emailResults) => {
        if (emailErr) {
          console.error("❌ Database error:", emailErr);
          return res.status(500).json({ message: "Ikosa mu kureba email!" });
        }

        if (emailResults.length > 0) {
          return res.status(400).json({ message: "Email yamaze kwandikwa!" });
        }

        proceedWithUpdate();
      });
    } else {
      proceedWithUpdate();
    }

    function proceedWithUpdate() {
      // If password is being changed, verify current password first
      if (newPassword) {
        if (!currentPassword) {
          return res.status(400).json({ message: "Ukeneye password ya kuri ubu wo guhindura password!" });
        }

        // Verify current password
        bcrypt.compare(currentPassword, currentAdmin.password, (compareErr, valid) => {
          if (compareErr) {
            console.error("❌ Password comparison error:", compareErr);
            return res.status(500).json({ message: "Ikosa mu kureba password!" });
          }

          if (!valid) {
            return res.status(400).json({ message: "Password ya kuri ubu siyo!" });
          }

          // Hash new password and update
          bcrypt.hash(newPassword, 12, (hashErr, hashedPassword) => {
            if (hashErr) {
              console.error("❌ Hashing error:", hashErr);
              return res.status(500).json({ message: "Ikosa mu kubika password nshya!" });
            }

            updateAdmin(hashedPassword);
          });
        });
      } else {
        // Update without changing password
        updateAdmin(null);
      }
    }

    function updateAdmin(hashedPassword) {
      let updateQuery, queryParams;

      if (hashedPassword) {
        updateQuery = "UPDATE admin SET email = ?, telephone = ?, password = ? WHERE id = ?";
        queryParams = [email, telephone, hashedPassword, adminId];
      } else {
        updateQuery = "UPDATE admin SET email = ?, telephone = ? WHERE id = ?";
        queryParams = [email, telephone, adminId];
      }

      db.query(updateQuery, queryParams, (updateErr, result) => {
        if (updateErr) {
          console.error("❌ Database update error:", updateErr);
          return res.status(500).json({ message: "Ikosa mu guhindura amakuru!" });
        }

        // Update session data
        const sessionId = req.header('X-Session-ID');
        if (sessionId && adminSessions.has(sessionId)) {
          const session = adminSessions.get(sessionId);
          session.email = email;
          session.telephone = telephone;
          adminSessions.set(sessionId, session);
        }

        // Get updated admin data
        db.query(getAdminQuery, [adminId], (selectErr, adminResults) => {
          if (selectErr) {
            console.error("❌ Database select error:", selectErr);
            return res.status(500).json({ message: "Ikosa mu kubona amakuru mashya!" });
          }

          const updatedAdmin = adminResults[0];
          const { password: _, ...adminWithoutPassword } = updatedAdmin;

          res.status(200).json({
            message: "Amakuru ya admin yahinduwe neza!",
            admin: adminWithoutPassword
          });
        });
      });
    }
  });
});
// UPDATE YOUR EXISTING BACKEND CODE - Add status field to all user queries

// GET ALL USERS (Protected) - Update to include status
app.get("/api/admin/users", verifyAdmin, (req, res) => {
  db.query("SELECT id, amazina, ref_telephone, aho_uherereye, telephone, status, created_at FROM users", (err, result) => {
    if (err) {
      console.error("❌ Database error:", err);
      return res.status(500).json({ message: "Ikosa mu kubona abakoresha!" });
    }
    res.status(200).json({ users: result });
  });
});

// GET USER BY ID (Protected) - Update to include status
app.get("/api/admin/user/:id", verifyAdmin, (req, res) => {
  const { id } = req.params;
  const getQuery = "SELECT id, amazina, ref_telephone, aho_uherereye, telephone, status, created_at FROM users WHERE id = ?";
  db.query(getQuery, [id], (err, result) => {
    if (err) {
      console.error("❌ Database error:", err);
      return res.status(500).json({ message: "Ikosa mu kubona umukoresha!" });
    }
    res.status(200).json({ user: result[0] });
  });
});

// UPDATE USER STATUS (Protected) - This should already exist
app.put("/api/admin/user/:id", verifyAdmin, (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  
  const updateQuery = "UPDATE users SET status = ? WHERE id = ?";
  db.query(updateQuery, [status, id], (err, result) => {
    if (err) {
      console.error("❌ Database error:", err);
      return res.status(500).json({ message: "Ikosa mu guhindura status!" });
    }
    
    // Return updated user data
    const getQuery = "SELECT id, amazina, ref_telephone, aho_uherereye, telephone, status, created_at FROM users WHERE id = ?";
    db.query(getQuery, [id], (selectErr, userResult) => {
      if (selectErr) {
        console.error("❌ Database select error:", selectErr);
        return res.status(500).json({ message: "Ikosa mu kubona umukoresha!" });
      }
      
      res.status(200).json({ 
        message: "Status updated successfully",
        user: userResult[0]
      });
    });
  });
});

// ADMIN LOGOUT
app.post("/api/admin/logout", (req, res) => {
  const sessionId = req.header('X-Session-ID');
  if (sessionId) {
    adminSessions.delete(sessionId);
  }
  res.status(200).json({ message: "Wasohotse neza!" });
});

// 🟢 Signup route
app.post("/api/signup", (req, res) => {
  console.log("📥 Signup request received:", req.body);
  
  const { amazina, ref_telephone, aho_uherereye, telephone, pin } = req.body;

  // Validation
  if (!amazina || !ref_telephone || !telephone || !pin) {
    console.log("❌ Missing fields");
    return res.status(400).json({ message: "Ubutumwa burahari!" });
  }

  if (pin.length !== 4 || !/^\d+$/.test(pin)) {
    console.log("❌ Invalid PIN format");
    return res.status(400).json({ message: "PIN igomba kuba imibare 4!" });
  }

  if (!/^07[0-9]{8}$/.test(telephone)) {
    console.log("❌ Invalid telephone format");
    return res.status(400).json({ message: "Telephone igomba kuba 10 imibare (07...)!" });
  }

  // Check if user exists
  console.log("🔍 Checking if user exists...");
  db.query(
    'SELECT telephone FROM users WHERE telephone = ?',
    [telephone],
    (err, results) => {
      if (err) {
        console.log("❌ Database check error:", err);
        return res.status(500).json({ message: "Ikosa mu kureba telephone!" });
      }

      if (results.length > 0) {
        console.log("❌ User already exists");
        return res.status(400).json({ message: "Telephone yamaze kwandikwa!" });
      }

      console.log("🔐 Hashing PIN...");
      bcrypt.hash(pin, 10, (hashErr, hashedPin) => {
        if (hashErr) {
          console.log("❌ Hashing error:", hashErr);
          return res.status(500).json({ message: "Ikosa mu kubika PIN!" });
        }

        console.log("💾 Creating user in database...");
        db.query(
          'INSERT INTO users (amazina, ref_telephone, aho_uherereye, telephone, pin) VALUES (?, ?, ?, ?, ?)',
          [amazina, ref_telephone, aho_uherereye, telephone, hashedPin],
          (insertErr, result) => {
            if (insertErr) {
              console.log("❌ Database insert error:", insertErr);
              return res.status(500).json({ message: "Ikosa mu kubika amakuru!" });
            }

            // Get the created user
            db.query(
              'SELECT id, amazina, ref_telephone, aho_uherereye, telephone, created_at FROM users WHERE id = ?',
              [result.insertId],
              (selectErr, userResults) => {
                if (selectErr) {
                  console.log("❌ Database select error:", selectErr);
                  return res.status(500).json({ message: "Ikosa mu kubona umukoresha!" });
                }

                console.log("✅ User created successfully");
                res.json({ 
                  message: "Umukoresha yanditswe neza!", 
                  user: userResults[0] 
                });
              }
            );
          }
        );
      });
    }
  );
});

// 🔵 Login route
app.post("/api/login", (req, res) => {
  console.log("📥 Login request received:", req.body);
  
  const { telephone, pin } = req.body;

  // Validation
  if (!telephone || !pin) {
    return res.status(400).json({ message: "Telephone na PIN byarahari!" });
  }

  if (pin.length !== 4 || !/^\d+$/.test(pin)) {
    return res.status(400).json({ message: "PIN igomba kuba imibare 4!" });
  }

  console.log("🔍 Fetching user from database...");
  db.query(
    'SELECT id, amazina, ref_telephone, aho_uherereye, telephone, pin FROM users WHERE telephone = ?',
    [telephone],
    (err, results) => {
      if (err) {
        console.log("❌ Database error:", err);
        return res.status(500).json({ message: "Ikosa mu kureba umukoresha!" });
      }

      if (results.length === 0) {
        console.log("❌ User not found");
        return res.status(400).json({ message: "Telephone ntibonetse!" });
      }

      const user = results[0];

      console.log("🔐 Comparing PIN...");
      bcrypt.compare(pin, user.pin, (compareErr, valid) => {
        if (compareErr) {
          console.log("❌ PIN comparison error:", compareErr);
          return res.status(500).json({ message: "Ikosa mu kureba PIN!" });
        }

        if (!valid) {
          console.log("❌ Invalid PIN");
          return res.status(400).json({ message: "PIN siyo!" });
        }

        // Remove pin from response for security
        const { pin: _, ...userWithoutPin } = user;

        console.log("✅ Login successful for user:", user.id);
        res.json({ 
          message: "Winjiye neza!", 
          user: userWithoutPin 
        });
      });
    }
  );
});

// 🟡 Forgot Password
app.post('/api/forgot-password', (req, res) => {
  console.log("📥 Forgot password request received:", req.body);
  
  const { telephone } = req.body;
  
  // Check if user exists
  console.log("🔍 Checking if user exists...");
  db.query(
    'SELECT id, telephone FROM users WHERE telephone = ?',
    [telephone],
    (err, results) => {
      if (err) {
        console.log("❌ Database error:", err);
        return res.status(500).json({ message: "Ikosa mu kureba telephone!" });
      }

      if (results.length === 0) {
        console.log("❌ User not found");
        return res.status(404).json({ message: "Ntawanditswe muri telephone iyo!" });
      }
      
      // Generate 6-digit token
      const token = Math.floor(100000 + Math.random() * 900000).toString();
      
      // Save token to user with expiration (e.g., 10 minutes)
      console.log("💾 Saving reset token...");
      const resetTokenExpiry = new Date(Date.now() + 10 * 60 * 1000);
      
      db.query(
        'UPDATE users SET reset_token = ?, reset_token_expiry = ? WHERE telephone = ?',
        [token, resetTokenExpiry, telephone],
        (updateErr) => {
          if (updateErr) {
            console.log("❌ Error saving token:", updateErr);
            return res.status(500).json({ message: "Ikosa mu kubika token!" });
          }
          
          // Here you would send the token via SMS
          console.log(`✅ Token generated for ${telephone}: ${token}`);
          
          res.json({ 
            message: "Token yo guhindura PIN yoherejwe ku number yawe!",
            token: token // Remove this in production - only for testing
          });
        }
      );
    }
  );
});

// 🟢 Reset Password
app.post('/api/reset-password', (req, res) => {
  console.log("📥 Reset password request received:", req.body);
  
  const { telephone, token, newPassword } = req.body;
  
  // Validation
  if (newPassword.length !== 4 || !/^\d+$/.test(newPassword)) {
    return res.status(400).json({ message: "PIN nshya igomba kuba imibare 4!" });
  }

  console.log("🔍 Verifying token...");
  db.query(
    'SELECT id, reset_token, reset_token_expiry FROM users WHERE telephone = ? AND reset_token = ? AND reset_token_expiry > ?',
    [telephone, token, new Date()],
    (err, results) => {
      if (err) {
        console.log("❌ Database error:", err);
        return res.status(500).json({ message: "Ikosa mu kureba token!" });
      }

      if (results.length === 0) {
        console.log("❌ Invalid or expired token");
        return res.status(400).json({ message: "Token ntabwo ari yo cyanga ntiyarangije!" });
      }
      
      // Hash new password
      console.log("🔐 Hashing new PIN...");
      bcrypt.hash(newPassword, 10, (hashErr, hashedPin) => {
        if (hashErr) {
          console.log("❌ Hashing error:", hashErr);
          return res.status(500).json({ message: "Ikosa mu kubika PIN nshya!" });
        }
        
        // Update password and clear reset token
        console.log("💾 Updating password...");
        db.query(
          'UPDATE users SET pin = ?, reset_token = NULL, reset_token_expiry = NULL WHERE telephone = ?',
          [hashedPin, telephone],
          (updateErr) => {
            if (updateErr) {
              console.log("❌ Error updating password:", updateErr);
              return res.status(500).json({ message: "Ikosa mu guhindura PIN!" });
            }
            
            console.log("✅ Password reset successfully");
            res.json({ message: "PIN nshya yashizweho neza!" });
          }
        );
      });
    }
  );
});

// 🟣 CLIENT MANAGEMENT ROUTES

// 🟢 Add Client/Product route
app.post("/api/clients", (req, res) => {
  console.log("📥 Client/Product creation request received:", req.body);
  
  const { amazina, telephone, igicuruzwa, amafaranga, created_by, creator_telephone, creator_name } = req.body;

  // Validation
  if (!amazina || !telephone || !created_by || !creator_telephone) {
    console.log("❌ Missing required fields");
    return res.status(400).json({ message: "Amazina, Telephone, User ID na Creator Telephone bya ngombwa!" });
  }

  if (!/^07[0-9]{8}$/.test(telephone)) {
    console.log("❌ Invalid telephone format");
    return res.status(400).json({ message: "Telephone igomba kuba 10 imibare (07...)!" });
  }

  console.log("💾 Creating client/product in database...");
  
  db.query(
    'INSERT INTO abonizera (amazina, telephone, igicuruzwa, amafaranga, created_by, creator_telephone, creator_name) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [amazina, telephone, igicuruzwa || "Nta bicuruzwa", amafaranga || "0", created_by, creator_telephone, creator_name || "System"],
    (err, result) => {
      if (err) {
        console.log("❌ Database insert error:", err);
        return res.status(500).json({ message: "Ikosa mu kubika umwizerwa!" });
      }

      // Get the created client
      db.query(
        'SELECT * FROM abonizera WHERE id = ?',
        [result.insertId],
        (selectErr, clientResults) => {
          if (selectErr) {
            console.log("❌ Database select error:", selectErr);
            return res.status(500).json({ message: "Ikosa mu kubona umwizerwa!" });
          }

          console.log("✅ Client/Product created successfully");
          res.json({ 
            message: "Igicuruzwa cyongewemo neza!", 
            client: clientResults[0] 
          });
        }
      );
    }
  );
});

// 🟢 ADD PRODUCT TO EXISTING CLIENT route
app.post("/api/clients/add-product", (req, res) => {
  console.log("📥 Add product request received:", req.body);
  
  const { telephone, igicuruzwa, amafaranga, created_by, creator_telephone, creator_name } = req.body;

  // Validation
  if (!telephone || !igicuruzwa || !created_by || !creator_telephone) {
    console.log("❌ Missing required fields");
    return res.status(400).json({ message: "Telephone, Igicuruzwa, User ID na Creator Telephone bya ngombwa!" });
  }

  if (!/^07[0-9]{8}$/.test(telephone)) {
    console.log("❌ Invalid telephone format");
    return res.status(400).json({ message: "Telephone igomba kuba 10 imibare (07...)!" });
  }

  // Check if client exists first
  console.log("🔍 Checking if client exists...");
  db.query(
    'SELECT amazina, telephone FROM abonizera WHERE telephone = ? LIMIT 1',
    [telephone],
    (checkErr, existingClients) => {
      if (checkErr) {
        console.log("❌ Database check error:", checkErr);
        return res.status(500).json({ message: "Ikosa mu kureba telephone!" });
      }

      if (!existingClients || existingClients.length === 0) {
        console.log("❌ Client not found");
        return res.status(404).json({ message: "Nta mwizerwa ufite telephone iyo!" });
      }

      const clientName = existingClients[0].amazina;

      console.log("💾 Adding product to existing client...");
      
      // Insert new product for existing client
      db.query(
        'INSERT INTO abonizera (amazina, telephone, igicuruzwa, amafaranga, created_by, creator_telephone, creator_name) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [clientName, telephone, igicuruzwa, amafaranga || "0", created_by, creator_telephone, creator_name || "System"],
        (err, result) => {
          if (err) {
            console.log("❌ Database insert error:", err);
            return res.status(500).json({ message: "Ikosa mu kubika igicuruzwa!" });
          }

          // Get the created product
          db.query(
            'SELECT * FROM abonizera WHERE id = ?',
            [result.insertId],
            (selectErr, productResults) => {
              if (selectErr) {
                console.log("❌ Database select error:", selectErr);
                return res.status(500).json({ message: "Ikosa mu kubona igicuruzwa!" });
              }

              console.log("✅ Product added successfully to:", clientName);
              res.json({ 
                message: `Igicuruzwa cyongewemo kuri ${clientName}!`, 
                client: productResults[0] 
              });
            }
          );
        }
      );
    }
  );
});

// 🔵 Get All Clients route
app.get("/api/clients", (req, res) => {
  console.log("📥 Fetching clients request received");
  
  db.query(
    `SELECT a.*, u.amazina as creator_name, u.telephone as creator_telephone 
     FROM abonizera a 
     LEFT JOIN users u ON a.created_by = u.id 
     ORDER BY a.amazina DESC`,
    (err, clients) => {
      if (err) {
        console.log("❌ Database fetch error:", err);
        return res.status(500).json({ message: "Ikosa mu kubona abawizera!" });
      }

      console.log(`✅ Retrieved ${clients.length} clients successfully`);
      res.json({ 
        message: "Abawizera bibaswe neza!", 
        clients: clients 
      });
    }
  );
});

// 🔵 Get My Clients route
app.get("/api/my-clients/:userId", (req, res) => {
  const userId = req.params.userId;
  console.log(`📥 Fetching clients for user: ${userId}`);
  
  db.query(
    `SELECT a.*, u.amazina as creator_name, u.telephone as creator_telephone 
     FROM abonizera a 
     LEFT JOIN users u ON a.created_by = u.id 
     WHERE a.created_by = ? 
     ORDER BY a.id DESC`,
    [userId],
    (err, clients) => {
      if (err) {
        console.log("❌ Database fetch error:", err);
        return res.status(500).json({ message: "Ikosa mu kubona abawizera wawe!" });
      }

      console.log(`✅ Retrieved ${clients.length} clients for user ${userId}`);
      res.json({ 
        message: "Abawizera wawe bibaswe neza!", 
        clients: clients 
      });
    }
  );
});

// 🟣 Get Single Client Details by ID route
app.get("/api/clients/:id", (req, res) => {
  const clientId = req.params.id;
  console.log(`📥 Fetching client details for ID: ${clientId}`);
  
  db.query(
    `SELECT a.*, u.amazina as creator_name, u.telephone as creator_telephone 
     FROM abonizera a 
     LEFT JOIN users u ON a.created_by = u.id 
     WHERE a.id = ?`,
    [clientId],
    (err, results) => {
      if (err) {
        console.log("❌ Database fetch error:", err);
        return res.status(500).json({ message: "Ikosa mu kubona amakuru y'umwizerwa!" });
      }

      if (results.length === 0) {
        console.log("❌ Client not found");
        return res.status(404).json({ message: "Umwizerwa ntaborerwa!" });
      }

      console.log("✅ Client details retrieved successfully");
      res.json({ 
        message: "Amakuru y'umwizerwa abaswe neza!", 
        client: results[0] 
      });
    }
  );
});

// 🔵 GET CLIENT BY TELEPHONE (with all products) route
app.get("/api/clients/telephone/:telephone", (req, res) => {
  const telephone = req.params.telephone;
  console.log(`📥 Fetching client by telephone: ${telephone}`);
  
  db.query(
    `SELECT a.*, u.amazina as creator_name, u.telephone as creator_telephone 
     FROM abonizera a 
     LEFT JOIN users u ON a.created_by = u.id 
     WHERE a.telephone = ? 
     ORDER BY a.id DESC`,
    [telephone],
    (err, clients) => {
      if (err) {
        console.log("❌ Database fetch error:", err);
        return res.status(500).json({ message: "Ikosa mu kubona umwizerwa!" });
      }

      if (!clients || clients.length === 0) {
        console.log("❌ Client not found");
        return res.status(404).json({ message: "Nta mwizerwa ufite telephone iyo!" });
      }

      // Group products for this client
      const clientInfo = {
        amazina: clients[0].amazina,
        telephone: clients[0].telephone,
        totalAmount: clients.reduce((sum, client) => sum + (parseInt(client.amafaranga) || 0), 0),
        products: clients.map(client => ({
          id: client.id,
          igicuruzwa: client.igicuruzwa,
          amafaranga: parseInt(client.amafaranga) || 0,
          created_at: client.created_at,
          created_by: client.created_by,
          creator_name: client.creator_name,
          creator_telephone: client.creator_telephone
        }))
      };

      console.log(`✅ Retrieved ${clients.length} products for: ${clientInfo.amazina}`);
      res.json({ 
        message: "Amakuru y'umwizerwa abaswe neza!", 
        client: clientInfo 
      });
    }
  );
});

// 🟢 Check Telephone route
app.get("/api/clients/check-telephone/:telephone", (req, res) => {
  const telephone = req.params.telephone;
  console.log(`📥 Checking telephone: ${telephone}`);
  
  db.query(
    'SELECT amazina, telephone FROM abonizera WHERE telephone = ? LIMIT 1',
    [telephone],
    (err, results) => {
      if (err) {
        console.log("❌ Database check error:", err);
        return res.status(500).json({ message: "Ikosa mu kureba telephone!" });
      }

      const exists = results.length > 0;
      
      if (exists) {
        console.log(`✅ Telephone ${telephone} exists - Name: ${results[0].amazina}`);
        res.json({ 
          exists: true,
          clientName: results[0].amazina
        });
      } else {
        console.log(`✅ Telephone ${telephone} is available`);
        res.json({ 
          exists: false 
        });
      }
    }
  );
});

// 🟠 Update Client route
app.put("/api/clients/:id", (req, res) => {
  const clientId = req.params.id;
  console.log(`📥 Updating client ID: ${clientId}`, req.body);
  
  const { amazina, telephone, igicuruzwa, amafaranga } = req.body;

  // Validation
  if (!amazina || !telephone) {
    console.log("❌ Missing required fields");
    return res.status(400).json({ message: "Amazina na Telephone bya ngombwa!" });
  }

  if (!/^07[0-9]{8}$/.test(telephone)) {
    console.log("❌ Invalid telephone format");
    return res.status(400).json({ message: "Telephone igomba kuba 10 imibare (07...)!" });
  }

  console.log("🔍 Checking if client exists...");
  db.query(
    'SELECT id FROM abonizera WHERE id = ?',
    [clientId],
    (checkErr, results) => {
      if (checkErr || results.length === 0) {
        console.log("❌ Client not found");
        return res.status(404).json({ message: "Umwizerwa ntaborerwa!" });
      }

      console.log("💾 Updating client in database...");
      
      db.query(
        'UPDATE abonizera SET amazina = ?, telephone = ?, igicuruzwa = ?, amafaranga = ? WHERE id = ?',
        [amazina, telephone, igicuruzwa || "Nta bicuruzwa", amafaranga || "0", clientId],
        (updateErr, result) => {
          if (updateErr) {
            console.log("❌ Database update error:", updateErr);
            return res.status(500).json({ message: "Ikosa mu guhindura umwizerwa!" });
          }

          // Get updated client
          db.query(
            'SELECT * FROM abonizera WHERE id = ?',
            [clientId],
            (selectErr, clientResults) => {
              if (selectErr) {
                console.log("❌ Database select error:", selectErr);
                return res.status(500).json({ message: "Ikosa mu kubona umwizerwa!" });
              }

              console.log("✅ Client updated successfully");
              res.json({ 
                message: "Umwizerwa wahinduwe neza!", 
                client: clientResults[0] 
              });
            }
          );
        }
      );
    }
  );
});

// 🔴 DELETE CLIENT PRODUCT route
app.delete("/api/clients/product/:id", (req, res) => {
  const productId = req.params.id;
  console.log(`📥 Deleting product ID: ${productId}`);
  
  console.log("🔍 Checking if product exists...");
  db.query(
    'SELECT id FROM abonizera WHERE id = ?',
    [productId],
    (checkErr, results) => {
      if (checkErr || results.length === 0) {
        console.log("❌ Product not found");
        return res.status(404).json({ message: "Igicuruzwa ntibonetse!" });
      }

      console.log("🗑️ Deleting product from database...");
      
      db.query(
        'DELETE FROM abonizera WHERE id = ?',
        [productId],
        (deleteErr) => {
          if (deleteErr) {
            console.log("❌ Database delete error:", deleteErr);
            return res.status(500).json({ message: "Ikosa mu gusiba igicuruzwa!" });
          }

          console.log("✅ Product deleted successfully");
          res.json({ 
            message: "Igicuruzwa cyasibwe neza!"
          });
        }
      );
    }
  );
});

// 🔴 Delete Client route (deletes all products for this telephone)
app.delete("/api/clients/:telephone", (req, res) => {
  const telephone = req.params.telephone;
  console.log(`📥 Deleting all products for client: ${telephone}`);
  
  console.log("🔍 Checking if client exists...");
  db.query(
    'SELECT id, amazina FROM abonizera WHERE telephone = ?',
    [telephone],
    (checkErr, existingClient) => {
      if (checkErr || existingClient.length === 0) {
        console.log("❌ Client not found");
        return res.status(404).json({ message: "Nta mwizerwa ufite telephone iyo!" });
      }

      console.log(`🗑️ Deleting ${existingClient.length} products for: ${existingClient[0].amazina}`);
      
      db.query(
        'DELETE FROM abonizera WHERE telephone = ?',
        [telephone],
        (deleteErr) => {
          if (deleteErr) {
            console.log("❌ Database delete error:", deleteErr);
            return res.status(500).json({ message: "Ikosa mu gusiba umwizerwa!" });
          }

          console.log("✅ Client and all products deleted successfully");
          res.json({ 
            message: "Umwizerwa n'ibicuruzwa byasibwe neza!"
          });
        }
      );
    }
  );
});

// 🟡 Get Client Statistics route
app.get("/api/clients/stats", (req, res) => {
  console.log("📥 Fetching client statistics");
  
  db.query(
    'SELECT amafaranga, telephone FROM abonizera',
    (err, clients) => {
      if (err) {
        console.log("❌ Database stats error:", err);
        return res.status(500).json({ message: "Ikosa mu kubona statistics!" });
      }

      const uniqueTelephones = [...new Set(clients.map(client => client.telephone))];
      const totalClients = uniqueTelephones.length;
      const totalProducts = clients.length;
      const totalDebt = clients.reduce((sum, client) => {
        return sum + (parseInt(client.amafaranga) || 0);
      }, 0);

      console.log(`✅ Statistics: ${totalClients} clients, ${totalProducts} products, ${totalDebt} RWF`);
      res.json({ 
        totalClients,
        totalProducts,
        totalDebt
      });
    }
  );
});

// PAYMENT TRANSACTION
// 🟢 Record Payment History
app.post("/api/history", (req, res) => {
  console.log("📥 Recording payment history:", req.body);
  
  const { abonizera_id, amazina, amafaranga, telephone } = req.body;

  // Validation
  if (!abonizera_id || !amazina || !telephone) {
    return res.status(400).json({ message: "Abonizera ID, Amazina na Telephone bya ngombwa!" });
  }

  console.log("💾 Saving payment history...");
  
  db.query(
    'INSERT INTO history (abonizera_id, amazina, amafaranga, telephone) VALUES (?, ?, ?, ?)',
    [abonizera_id, amazina, amafaranga || "0", telephone],
    (err, result) => {
      if (err) {
        console.log("❌ History insert error:", err);
        return res.status(500).json({ message: "Ikosa mu kubika amakuru mu history!" });
      }

      console.log("✅ Payment history recorded successfully");
      res.json({ 
        message: "Amakuru yanditswe mu history!", 
        history_id: result.insertId 
      });
    }
  );
});

// 🔵 Get Payment History
app.get("/api/history", (req, res) => {
  console.log("📥 Fetching payment history");
  
  db.query(
    `SELECT h.*, a.igicuruzwa 
     FROM history h 
     LEFT JOIN abonizera a ON h.abonizera_id = a.id 
     ORDER BY h.history_date DESC`,
    (err, history) => {
      if (err) {
        console.log("❌ Database fetch error:", err);
        return res.status(500).json({ message: "Ikosa mu kubona history!" });
      }

      console.log(`✅ Retrieved ${history.length} history records`);
      res.json({ 
        message: "History ibaswe neza!", 
        history: history 
      });
    }
  );
});

// 🟡 Get Payment History by User
app.get("/api/history/user/:userId", (req, res) => {
  const userId = req.params.userId;
  console.log(`📥 Fetching payment history for user: ${userId}`);
  
  db.query(
    `SELECT h.*, a.igicuruzwa 
     FROM history h 
     LEFT JOIN abonizera a ON h.abonizera_id = a.id 
     WHERE a.created_by = ? 
     ORDER BY h.history_date DESC`,
    [userId],
    (err, history) => {
      if (err) {
        console.log("❌ Database fetch error:", err);
        return res.status(500).json({ message: "Ikosa mu kubona history y'umukoresha!" });
      }

      console.log(`✅ Retrieved ${history.length} history records for user ${userId}`);
      res.json({ 
        history: history 
      });
    }
  );
});

// CHECK USER EXISTEENCE
app.get('/api/clients/check/:telephone', async (req, res) => {
  const telephone = req.params.telephone;
  console.log(`📥 Checking client existence: ${telephone}`);
  
  db.query(
    'SELECT * FROM abonizera WHERE telephone = ? LIMIT 1',
    [telephone],
    (err, results) => {
      if (err) {
        console.log("❌ Database error:", err);
        return res.status(500).json({ error: "Ikosa mu kureba umwizerwa!" });
      }
      
      res.json({ 
        exists: !!results.length,
        client: results[0] || null
      });
    }
  );
});

app.put('/api/clients/update-balance', async (req, res) => {
  console.log("📥 Update balance request received:", req.body);
  
  const { telephone, additionalAmount, newProduct, updated_by } = req.body;
  
  // Find existing client
  db.query(
    'SELECT * FROM abonizera WHERE telephone = ? LIMIT 1',
    [telephone],
    (err, results) => {
      if (err || results.length === 0) {
        console.log("❌ Client not found");
        return res.status(404).json({ error: "Umwizerwa ntabwo abonetse" });
      }
      
      const client = results[0];
      
      // Update balance
      const newBalance = parseInt(client.amafaranga) + parseInt(additionalAmount);
      
      db.query(
        'UPDATE abonizera SET amafaranga = ?, updated_by = ? WHERE telephone = ?',
        [newBalance, updated_by, telephone],
        (updateErr) => {
          if (updateErr) {
            console.log("❌ Update error:", updateErr);
            return res.status(500).json({ error: "Ikosa mu guhindura balance!" });
          }
          
          // Add to history
          db.query(
            'INSERT INTO history (amazina, telephone, amafaranga, igicuruzwa, created_by, history_date) VALUES (?, ?, ?, ?, ?, ?)',
            [client.amazina, client.telephone, additionalAmount, newProduct, updated_by, new Date()],
            (historyErr) => {
              if (historyErr) {
                console.log("❌ History insert error:", historyErr);
              }
              
              res.json({ 
                success: true, 
                newBalance,
                client: { ...client, amafaranga: newBalance }
              });
            }
          );
        }
      );
    }
  );
});

// Health check route
app.get("/api/health", (req, res) => {
  res.json({ 
    message: "Server irakora neza!", 
    timestamp: new Date().toISOString()
  });
});

// Test database connection
app.get("/api/test-db", (req, res) => {
  db.query('SELECT * FROM users LIMIT 1', (err, results) => {
    if (err) {
      return res.status(500).json({ 
        message: "Database connection failed",
        error: err.message 
      });
    }
    
    res.json({ 
      message: "Database connection successful",
      table_exists: true,
      columns: results.length > 0 ? Object.keys(results[0]) : ['Table is empty']
    });
  });
});

// Test abonizera table connection
app.get("/api/test-clients", (req, res) => {
  db.query('SELECT * FROM abonizera LIMIT 1', (err, results) => {
    if (err) {
      return res.status(500).json({ 
        message: "Abonizera table connection failed",
        error: err.message 
      });
    }
    
    res.json({ 
      message: "Abonizera table connection successful",
      table_exists: true,
      columns: results.length > 0 ? Object.keys(results[0]) : ['Table is empty']
    });
  });
});
// UBUFASHA
// 🎫 TICKET MANAGEMENT ROUTES

// 🟢 CREATE TICKET route - FIXED
app.post("/api/tickets", (req, res) => {
  console.log("📥 Ticket creation request received:", req.body);
  
  const { amazina, telephone, description } = req.body;

  // Validation
  if (!amazina || !telephone) {
    console.log("❌ Missing required fields");
    return res.status(400).json({ message: "Amazina na telephone bya ngombwa!" });
  }

  if (!/^07[0-9]{8}$/.test(telephone)) {
    console.log("❌ Invalid telephone format");
    return res.status(400).json({ message: "Telephone igomba kuba 10 imibare (07...)!" });
  }

  console.log("💾 Creating ticket in database...");
  
  db.query(
    'INSERT INTO ticket (amazina, telephone, description) VALUES (?, ?, ?)',
    [amazina, telephone, description || null],
    (err, result) => {
      if (err) {
        console.log("❌ Database insert error:", err);
        return res.status(500).json({ message: "Ikosa mu kubika ticket!" });
      }

      // Get the created ticket
      db.query(
        'SELECT * FROM ticket WHERE id = ?',
        [result.insertId],
        (selectErr, ticketResults) => {
          if (selectErr) {
            console.log("❌ Database select error:", selectErr);
            return res.status(500).json({ message: "Ikosa mu kubona ticket!" });
          }

          console.log("✅ Ticket created successfully");
          res.status(201).json({ 
            message: "Ticket yanditswe neza!", 
            ticket: ticketResults[0] 
          });
        }
      );
    }
  );
});

// 🔵 GET ALL TICKETS route
app.get("/api/tickets", (req, res) => {
  console.log("📥 Fetching all tickets request received");
  
  db.query(
    'SELECT * FROM ticket ORDER BY id DESC',
    (err, tickets) => {
      if (err) {
        console.log("❌ Database fetch error:", err);
        return res.status(500).json({ message: "Ikosa mu kubona tickets!" });
      }

      console.log(`✅ Retrieved ${tickets.length} tickets successfully`);
      res.json({ 
        message: "Tickets zibaswe neza!", 
        tickets: tickets 
      });
    }
  );
});

// 🔵 GET SINGLE TICKET BY ID route
app.get("/api/tickets/:id", (req, res) => {
  const ticketId = req.params.id;
  console.log(`📥 Fetching ticket ID: ${ticketId}`);
  
  db.query(
    'SELECT * FROM ticket WHERE id = ?',
    [ticketId],
    (err, results) => {
      if (err) {
        console.log("❌ Database fetch error:", err);
        return res.status(500).json({ message: "Ikosa mu kubona ticket!" });
      }

      if (results.length === 0) {
        console.log("❌ Ticket not found");
        return res.status(404).json({ message: "Ticket ntibonetse!" });
      }

      console.log("✅ Ticket retrieved successfully");
      res.json({ 
        message: "Ticket ibaswe neza!", 
        ticket: results[0] 
      });
    }
  );
});

// 🟠 UPDATE TICKET route - FIXED
app.put("/api/tickets/:id", (req, res) => {
  const ticketId = req.params.id;
  console.log(`📥 Updating ticket ID: ${ticketId}`, req.body);
  
  const { amazina, telephone, description } = req.body;

  // Validation
  if (!amazina || !telephone) {
    console.log("❌ Missing required fields");
    return res.status(400).json({ message: "Amazina na telephone bya ngombwa!" });
  }

  if (!/^07[0-9]{8}$/.test(telephone)) {
    console.log("❌ Invalid telephone format");
    return res.status(400).json({ message: "Telephone igomba kuba 10 imibare (07...)!" });
  }

  console.log("🔍 Checking if ticket exists...");
  db.query(
    'SELECT id FROM ticket WHERE id = ?',
    [ticketId],
    (checkErr, results) => {
      if (checkErr || results.length === 0) {
        console.log("❌ Ticket not found");
        return res.status(404).json({ message: "Ticket ntibonetse!" });
      }

      console.log("💾 Updating ticket in database...");
      
      db.query(
        'UPDATE ticket SET amazina = ?, telephone = ?, description = ? WHERE id = ?',
        [amazina, telephone, description || null, ticketId],
        (updateErr, result) => {
          if (updateErr) {
            console.log("❌ Database update error:", updateErr);
            return res.status(500).json({ message: "Ikosa mu guhindura ticket!" });
          }

          // Get updated ticket
          db.query(
            'SELECT * FROM ticket WHERE id = ?',
            [ticketId],
            (selectErr, ticketResults) => {
              if (selectErr) {
                console.log("❌ Database select error:", selectErr);
                return res.status(500).json({ message: "Ikosa mu kubona ticket!" });
              }

              console.log("✅ Ticket updated successfully");
              res.json({ 
                message: "Ticket yahinduwe neza!", 
                ticket: ticketResults[0] 
              });
            }
          );
        }
      );
    }
  );
});

// 🔴 DELETE TICKET route
app.delete("/api/tickets/:id", (req, res) => {
  const ticketId = req.params.id;
  console.log(`📥 Deleting ticket ID: ${ticketId}`);
  
  console.log("🔍 Checking if ticket exists...");
  db.query(
    'SELECT id FROM ticket WHERE id = ?',
    [ticketId],
    (checkErr, results) => {
      if (checkErr || results.length === 0) {
        console.log("❌ Ticket not found");
        return res.status(404).json({ message: "Ticket ntibonetse!" });
      }

      console.log("🗑️ Deleting ticket from database...");
      
      db.query(
        'DELETE FROM ticket WHERE id = ?',
        [ticketId],
        (deleteErr) => {
          if (deleteErr) {
            console.log("❌ Database delete error:", deleteErr);
            return res.status(500).json({ message: "Ikosa mu gusiba ticket!" });
          }

          console.log("✅ Ticket deleted successfully");
          res.json({ 
            message: "Ticket yasibwe neza!"
          });
        }
      );
    }
  );
});

// 🟢 GET TICKETS WITH PAGINATION route (optional)
app.get("/api/tickets/page/:page/limit/:limit", (req, res) => {
  const page = parseInt(req.params.page) || 1;
  const limit = parseInt(req.params.limit) || 10;
  const offset = (page - 1) * limit;
  
  console.log(`📥 Fetching tickets page ${page}, limit ${limit}`);
  
  // Get total count
  db.query('SELECT COUNT(*) as total FROM ticket', (countErr, countResults) => {
    if (countErr) {
      console.log("❌ Count error:", countErr);
      return res.status(500).json({ message: "Ikosa mu kubona umubare w'amatickets!" });
    }
    
    const total = countResults[0].total;
    const totalPages = Math.ceil(total / limit);
    
    // Get paginated tickets
    db.query(
      'SELECT * FROM ticket ORDER BY id DESC LIMIT ? OFFSET ?',
      [limit, offset],
      (err, tickets) => {
        if (err) {
          console.log("❌ Database fetch error:", err);
          return res.status(500).json({ message: "Ikosa mu kubona tickets!" });
        }

        console.log(`✅ Retrieved ${tickets.length} tickets (page ${page})`);
        res.json({ 
          message: "Tickets zibaswe neza!", 
          tickets: tickets,
          pagination: {
            currentPage: page,
            totalPages: totalPages,
            totalTickets: total,
            hasNext: page < totalPages,
            hasPrev: page > 1
          }
        });
      }
    );
  });
});

// Test ticket table connection
app.get("/api/test-tickets", (req, res) => {
  db.query('SELECT * FROM ticket LIMIT 1', (err, results) => {
    if (err) {
      return res.status(500).json({ 
        message: "Ticket table connection failed",
        error: err.message 
      });
    }
    
    res.json({ 
      message: "Ticket table connection successful",
      table_exists: true,
      columns: results.length > 0 ? Object.keys(results[0]) : ['Table is empty']
    });
  });
});
// Test admin table connection
app.get("/api/test-admin", (req, res) => {
  db.query('SELECT * FROM admin LIMIT 1', (err, results) => {
    if (err) {
      return res.status(500).json({ 
        message: "Admin table connection failed",
        error: err.message 
      });
    }
    
    res.json({ 
      message: "Admin table connection successful",
      table_exists: true,
      columns: results.length > 0 ? Object.keys(results[0]) : ['Table is empty']
    });
  });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`🌐 Health check: http://localhost:${PORT}/api/health`);
  console.log(`👥 Users test: http://localhost:${PORT}/api/test-db`);
  console.log(`📋 Clients test: http://localhost:${PORT}/api/test-clients`);
  console.log(`👨‍💼 Admin test: http://localhost:${PORT}/api/test-admin`);
});