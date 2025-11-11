import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import bcrypt from "bcryptjs";
import { createClient } from "@supabase/supabase-js";

dotenv.config();
const app = express();

// Enhanced CORS configuration
app.use(cors({
  origin: "http://localhost:5173",
  credentials: true
}));

app.use(express.json());

// Initialize Supabase client
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// 🟢 Signup route
app.post("/api/signup", async (req, res) => {
  console.log("📥 Signup request received:", req.body);
  
  try {
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
    const { data: existingUser, error: checkError } = await supabase
      .from("users")
      .select("telephone")
      .eq("telephone", telephone)
      .single();

    if (checkError && checkError.code !== 'PGRST116') {
      console.log("❌ Database check error:", checkError);
      return res.status(500).json({ message: "Ikosa mu kureba telephone!" });
    }

    if (existingUser) {
      console.log("❌ User already exists");
      return res.status(400).json({ message: "Telephone yamaze kwandikwa!" });
    }

    console.log("🔐 Hashing PIN...");
    const hashedPin = await bcrypt.hash(pin, 10);

    console.log("💾 Creating user in database...");
    
    const { data, error } = await supabase
      .from("users")
      .insert({
        amazina: amazina,
        ref_telephone: ref_telephone,
        aho_uherereye: aho_uherereye,
        telephone: telephone,
        pin: hashedPin,
      })
      .select();

    if (error) {
      console.log("❌ Database insert error:", error);
      
      if (error.code === '42501') {
        return res.status(500).json({ message: "Ntamushobora yo gukora iyi operation!" });
      }
      if (error.code === '42P01') {
        return res.status(500).json({ message: "Table 'users' itariho! Reba Supabase." });
      }
      
      return res.status(500).json({ message: "Ikosa mu kubika amakuru!" });
    }

    console.log("✅ User created successfully");
    res.json({ 
      message: "Umukoresha yanditswe neza!", 
      user: data ? data[0] : null 
    });

  } catch (error) {
    console.error("💥 Signup error:", error);
    res.status(500).json({ message: "Ikosa mu kwiyandikisha!" });
  }
});

// 🔵 Login route
app.post("/api/login", async (req, res) => {
  console.log("📥 Login request received:", req.body);
  
  try {
    const { telephone, pin } = req.body;

    // Validation
    if (!telephone || !pin) {
      return res.status(400).json({ message: "Telephone na PIN byarahari!" });
    }

    if (pin.length !== 4 || !/^\d+$/.test(pin)) {
      return res.status(400).json({ message: "PIN igomba kuba imibare 4!" });
    }

    console.log("🔍 Fetching user from database...");
    const { data: user, error } = await supabase
      .from("users")
      .select("id, amazina, ref_telephone, aho_uherereye, telephone, pin")
      .eq("telephone", telephone)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        console.log("❌ User not found");
        return res.status(400).json({ message: "Telephone ntibonetse!" });
      }
      console.log("❌ Database error:", error);
      return res.status(500).json({ message: "Ikosa mu kureba umukoresha!" });
    }

    if (!user) {
      console.log("❌ User not found");
      return res.status(400).json({ message: "Telephone ntibonetse!" });
    }

    console.log("🔐 Comparing PIN...");
    const valid = await bcrypt.compare(pin, user.pin);
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
  } catch (error) {
    console.error("💥 Login error:", error);
    res.status(500).json({ message: "Ikosa mu kwinjira!" });
  }
});

// 🟡 Forgot Password
app.post('/api/forgot-password', async (req, res) => {
  console.log("📥 Forgot password request received:", req.body);
  
  const { telephone } = req.body;
  
  try {
    // Check if user exists
    console.log("🔍 Checking if user exists...");
    const { data: user, error: userError } = await supabase
      .from("users")
      .select("id, telephone")
      .eq("telephone", telephone)
      .single();

    if (userError || !user) {
      console.log("❌ User not found");
      return res.status(404).json({ message: "Ntawanditswe muri telephone iyo!" });
    }
    
    // Generate 6-digit token
    const token = Math.floor(100000 + Math.random() * 900000).toString();
    
    // Save token to user with expiration (e.g., 10 minutes)
    console.log("💾 Saving reset token...");
    const resetTokenExpiry = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 minutes
    
    const { error: updateError } = await supabase
      .from("users")
      .update({
        reset_token: token,
        reset_token_expiry: resetTokenExpiry
      })
      .eq("telephone", telephone);

    if (updateError) {
      console.log("❌ Error saving token:", updateError);
      return res.status(500).json({ message: "Ikosa mu kubika token!" });
    }
    
    // Here you would send the token via SMS
    // await sendSMS(telephone, `Token yo guhindura PIN: ${token}`);
    console.log(`✅ Token generated for ${telephone}: ${token}`);
    
    res.json({ 
      message: "Token yo guhindura PIN yoherejwe ku number yawe!",
      token: token // Remove this in production - only for testing
    });
  } catch (error) {
    console.error("💥 Forgot password error:", error);
    res.status(500).json({ message: "Ikosa mu kohereza token!" });
  }
});

// 🟢 Reset Password
app.post('/api/reset-password', async (req, res) => {
  console.log("📥 Reset password request received:", req.body);
  
  const { telephone, token, newPassword } = req.body;
  
  try {
    // Validation
    if (newPassword.length !== 4 || !/^\d+$/.test(newPassword)) {
      return res.status(400).json({ message: "PIN nshya igomba kuba imibare 4!" });
    }

    console.log("🔍 Verifying token...");
    const { data: user, error } = await supabase
      .from("users")
      .select("id, reset_token, reset_token_expiry")
      .eq("telephone", telephone)
      .eq("reset_token", token)
      .gt("reset_token_expiry", new Date().toISOString())
      .single();
    
    if (error || !user) {
      console.log("❌ Invalid or expired token");
      return res.status(400).json({ message: "Token ntabwo ari yo cyanga ntiyarangije!" });
    }
    
    // Hash new password
    console.log("🔐 Hashing new PIN...");
    const hashedPin = await bcrypt.hash(newPassword, 10);
    
    // Update password and clear reset token
    console.log("💾 Updating password...");
    const { error: updateError } = await supabase
      .from("users")
      .update({
        pin: hashedPin,
        reset_token: null,
        reset_token_expiry: null
      })
      .eq("telephone", telephone);

    if (updateError) {
      console.log("❌ Error updating password:", updateError);
      return res.status(500).json({ message: "Ikosa mu guhindura PIN!" });
    }
    
    console.log("✅ Password reset successfully");
    res.json({ message: "PIN nshya yashizweho neza!" });
  } catch (error) {
    console.error("💥 Reset password error:", error);
    res.status(500).json({ message: "Ikosa mu guhindura PIN!" });
  }
});

// 🟣 CLIENT MANAGEMENT ROUTES - UPDATED WITH COMPLETE USER TRACKING

// 🟢 Add Client/Product route - UPDATED: With complete user tracking
app.post("/api/clients", async (req, res) => {
  console.log("📥 Client/Product creation request received:", req.body);
  
  try {
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
    
    const { data, error } = await supabase
      .from("abonizera")
      .insert({
        amazina: amazina,
        telephone: telephone,
        igicuruzwa: igicuruzwa || "Nta bicuruzwa",
        amafaranga: amafaranga || "0",
        created_by: created_by,
        creator_telephone: creator_telephone,
        creator_name: creator_name || "System"
      })
      .select();

    if (error) {
      console.log("❌ Database insert error:", error);
      
      if (error.code === '42501') {
        return res.status(500).json({ message: "Ntamushobora yo gukora iyi operation!" });
      }
      if (error.code === '42P01') {
        return res.status(500).json({ message: "Table 'abonizera' itariho! Reba Supabase." });
      }
      
      return res.status(500).json({ message: "Ikosa mu kubika umwizerwa!" });
    }

    console.log("✅ Client/Product created successfully");
    res.json({ 
      message: "Igicuruzwa cyongewemo neza!", 
      client: data ? data[0] : null 
    });

  } catch (error) {
    console.error("💥 Client creation error:", error);
    res.status(500).json({ message: "Ikosa mu kubika umwizerwa!" });
  }
});

// 🟢 ADD PRODUCT TO EXISTING CLIENT route - UPDATED: With complete user tracking
app.post("/api/clients/add-product", async (req, res) => {
  console.log("📥 Add product request received:", req.body);
  
  try {
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
    const { data: existingClients, error: checkError } = await supabase
      .from("abonizera")
      .select("amazina, telephone")
      .eq("telephone", telephone)
      .limit(1);

    if (checkError) {
      console.log("❌ Database check error:", checkError);
      return res.status(500).json({ message: "Ikosa mu kureba telephone!" });
    }

    if (!existingClients || existingClients.length === 0) {
      console.log("❌ Client not found");
      return res.status(404).json({ message: "Nta mwizerwa ufite telephone iyo!" });
    }

    const clientName = existingClients[0].amazina;

    console.log("💾 Adding product to existing client...");
    
    // Insert new product for existing client
    const { data, error } = await supabase
      .from("abonizera")
      .insert({
        amazina: clientName,
        telephone: telephone,
        igicuruzwa: igicuruzwa,
        amafaranga: amafaranga || "0",
        created_by: created_by,
        creator_telephone: creator_telephone,
        creator_name: creator_name || "System"
      })
      .select();

    if (error) {
      console.log("❌ Database insert error:", error);
      return res.status(500).json({ message: "Ikosa mu kubika igicuruzwa!" });
    }

    console.log("✅ Product added successfully to:", clientName);
    res.json({ 
      message: `Igicuruzwa cyongewemo kuri ${clientName}!`, 
      client: data ? data[0] : null 
    });

  } catch (error) {
    console.error("💥 Add product error:", error);
    res.status(500).json({ message: "Ikosa mu kubika igicuruzwa!" });
  }
});

// 🔵 Get All Clients route - UPDATED: With complete user info
app.get("/api/clients", async (req, res) => {
  console.log("📥 Fetching clients request received");
  
  try {
    const { data: clients, error } = await supabase
      .from("abonizera")
      .select(`
        *,
        users:created_by (amazina, telephone)
      `)
      .order("amazina", { ascending: false });

    if (error) {
      console.log("❌ Database fetch error:", error);
      return res.status(500).json({ message: "Ikosa mu kubona abawizera!" });
    }

    // Enhance clients with creator information
    const enhancedClients = clients?.map(client => ({
      ...client,
      createdBy: client.created_by,
      creatorName: client.creator_name || client.users?.amazina || "System",
      creatorTelephone: client.creator_telephone || client.users?.telephone
    })) || [];

    console.log(`✅ Retrieved ${enhancedClients.length} clients successfully`);
    res.json({ 
      message: "Abawizera bibaswe neza!", 
      clients: enhancedClients 
    });

  } catch (error) {
    console.error("💥 Clients fetch error:", error);
    res.status(500).json({ message: "Ikosa mu kubona abawizera!" });
  }
});

// 🔵 Get My Clients route - UPDATED: With complete user info
app.get("/api/my-clients/:userId", async (req, res) => {
  const userId = req.params.userId;
  console.log(`📥 Fetching clients for user: ${userId}`);
  
  try {
    const { data: clients, error } = await supabase
      .from("abonizera")
      .select(`
        *,
        users:created_by (amazina, telephone)
      `)
      .eq("created_by", userId)
      .order("id", { ascending: false });

    if (error) {
      console.log("❌ Database fetch error:", error);
      return res.status(500).json({ message: "Ikosa mu kubona abawizera wawe!" });
    }

    // Enhance clients with creator information
    const enhancedClients = clients?.map(client => ({
      ...client,
      createdBy: client.created_by,
      creatorName: client.creator_name || client.users?.amazina || "System",
      creatorTelephone: client.creator_telephone || client.users?.telephone
    })) || [];

    console.log(`✅ Retrieved ${enhancedClients.length} clients for user ${userId}`);
    res.json({ 
      message: "Abawizera wawe bibaswe neza!", 
      clients: enhancedClients 
    });

  } catch (error) {
    console.error("💥 My clients fetch error:", error);
    res.status(500).json({ message: "Ikosa mu kubona abawizera wawe!" });
  }
});

// 🆕 GET CLIENTS FOR CROSS-USER TRACKING - FIXED VERSION
app.get("/api/cross-user-clients/:userTelephone", async (req, res) => {
  const userTelephone = req.params.userTelephone;
  console.log(`📥 Fetching cross-user clients for: ${userTelephone}`);
  
  try {
    // FIXED: Filter clients where telephone matches userTelephone AND created_by is different from current user
    const { data: allClients, error } = await supabase
      .from("abonizera")
      .select(`
        *,
        users:created_by (amazina, telephone)
      `)
      .eq("telephone", userTelephone) // FIXED: Only get clients with this telephone
      .order("created_at", { ascending: false });

    if (error) {
      console.log("❌ Database fetch error:", error);
      return res.status(500).json({ message: "Ikosa mu kubona abawizera!" });
    }

    // FIXED: Filter out clients created by the current user (we only want those created by others)
    const crossUserClients = allClients?.filter(client => {
      // Get current user ID from query parameter if provided
      const currentUserId = req.query.currentUserId;
      if (currentUserId) {
        return client.created_by !== currentUserId;
      }
      return true; // If no currentUserId provided, return all
    }) || [];

    // Enhance clients with creator information
    const enhancedClients = crossUserClients.map(client => ({
      ...client,
      createdBy: client.created_by,
      creatorName: client.creator_name || client.users?.amazina || "System",
      creatorTelephone: client.creator_telephone || client.users?.telephone
    }));

    console.log(`✅ Retrieved ${enhancedClients.length} cross-user clients for ${userTelephone}`);
    res.json({ 
      message: "Abanyizera bibaswe neza!", 
      clients: enhancedClients 
    });

  } catch (error) {
    console.error("💥 Cross-user clients fetch error:", error);
    res.status(500).json({ message: "Ikosa mu kubona abanyizera!" });
  }
});

// 🆕 GET ABANYIZERA FOR SPECIFIC USER - OPTIMIZED VERSION
app.get("/api/abanyizera/:userTelephone", async (req, res) => {
  const userTelephone = req.params.userTelephone;
  const currentUserId = req.query.currentUserId;
  
  console.log(`📥 Fetching abanyizera for: ${userTelephone}, current user: ${currentUserId}`);
  
  try {
    // OPTIMIZED: Direct query to get only relevant data
    const { data: clients, error } = await supabase
      .from("abonizera")
      .select(`
        id,
        amazina,
        telephone,
        igicuruzwa,
        amafaranga,
        created_at,
        created_by,
        creator_name,
        creator_telephone,
        users:created_by (amazina, telephone)
      `)
      .eq("telephone", userTelephone)
      .neq("created_by", currentUserId) // FIXED: Exclude clients created by current user
      .order("created_at", { ascending: false });

    if (error) {
      console.log("❌ Database fetch error:", error);
      return res.status(500).json({ message: "Ikosa mu kubona abanyizera!" });
    }

    // Enhance clients with creator information
    const enhancedClients = clients?.map(client => ({
      ...client,
      createdBy: client.created_by,
      creatorName: client.creator_name || client.users?.amazina || "System",
      creatorTelephone: client.creator_telephone || client.users?.telephone
    })) || [];

    console.log(`✅ Retrieved ${enhancedClients.length} abanyizera for ${userTelephone}`);
    res.json({ 
      message: "Abanyizera bibaswe neza!", 
      clients: enhancedClients 
    });

  } catch (error) {
    console.error("💥 Abanyizera fetch error:", error);
    res.status(500).json({ message: "Ikosa mu kubona abanyizera!" });
  }
});

// 🟣 Get Single Client Details by ID route - UPDATED: With complete user info
app.get("/api/clients/:id", async (req, res) => {
  const clientId = req.params.id;
  console.log(`📥 Fetching client details for ID: ${clientId}`);
  
  try {
    const { data: client, error } = await supabase
      .from("abonizera")
      .select(`
        *,
        users:created_by (amazina, telephone)
      `)
      .eq("id", clientId)
      .single();

    if (error) {
      console.log("❌ Database fetch error:", error);
      
      if (error.code === 'PGRST116') {
        return res.status(404).json({ message: "Umwizerwa ntaborerwa!" });
      }
      
      return res.status(500).json({ message: "Ikosa mu kubona amakuru y'umwizerwa!" });
    }

    if (!client) {
      console.log("❌ Client not found");
      return res.status(404).json({ message: "Umwizerwa ntaborerwa!" });
    }

    // Enhance client with creator information
    const enhancedClient = {
      ...client,
      createdBy: client.created_by,
      creatorName: client.creator_name || client.users?.amazina || "System",
      creatorTelephone: client.creator_telephone || client.users?.telephone
    };

    console.log("✅ Client details retrieved successfully");
    res.json({ 
      message: "Amakuru y'umwizerwa abaswe neza!", 
      client: enhancedClient 
    });

  } catch (error) {
    console.error("💥 Client details fetch error:", error);
    res.status(500).json({ message: "Ikosa mu kubona amakuru y'umwizerwa!" });
  }
});

// 🔵 GET CLIENT BY TELEPHONE (with all products) route - UPDATED: With complete user info
app.get("/api/clients/telephone/:telephone", async (req, res) => {
  const telephone = req.params.telephone;
  console.log(`📥 Fetching client by telephone: ${telephone}`);
  
  try {
    const { data: clients, error } = await supabase
      .from("abonizera")
      .select(`
        *,
        users:created_by (amazina, telephone)
      `)
      .eq("telephone", telephone)
      .order("id", { ascending: false });

    if (error) {
      console.log("❌ Database fetch error:", error);
      return res.status(500).json({ message: "Ikosa mu kubona umwizerwa!" });
    }

    if (!clients || clients.length === 0) {
      console.log("❌ Client not found");
      return res.status(404).json({ message: "Nta mwizerwa ufite telephone iyo!" });
    }

    // Enhance clients with creator information
    const enhancedClients = clients.map(client => ({
      ...client,
      createdBy: client.created_by,
      creatorName: client.creator_name || client.users?.amazina || "System",
      creatorTelephone: client.creator_telephone || client.users?.telephone
    }));

    // Group products for this client
    const clientInfo = {
      amazina: clients[0].amazina,
      telephone: clients[0].telephone,
      totalAmount: clients.reduce((sum, client) => sum + (parseInt(client.amafaranga) || 0), 0),
      products: enhancedClients.map(client => ({
        id: client.id,
        igicuruzwa: client.igicuruzwa,
        amafaranga: parseInt(client.amafaranga) || 0,
        created_at: client.created_at,
        created_by: client.createdBy,
        creator_name: client.creatorName,
        creator_telephone: client.creatorTelephone
      }))
    };

    console.log(`✅ Retrieved ${clients.length} products for: ${clientInfo.amazina}`);
    res.json({ 
      message: "Amakuru y'umwizerwa abaswe neza!", 
      client: clientInfo 
    });

  } catch (error) {
    console.error("💥 Client by telephone fetch error:", error);
    res.status(500).json({ message: "Ikosa mu kubona amakuru y'umwizerwa!" });
  }
});

// 🟢 Check Telephone route
app.get("/api/clients/check-telephone/:telephone", async (req, res) => {
  const telephone = req.params.telephone;
  console.log(`📥 Checking telephone: ${telephone}`);
  
  try {
    const { data: existingClient, error } = await supabase
      .from("abonizera")
      .select("amazina, telephone")
      .eq("telephone", telephone)
      .single();

    if (error && error.code !== 'PGRST116') {
      console.log("❌ Database check error:", error);
      return res.status(500).json({ message: "Ikosa mu kureba telephone!" });
    }

    const exists = !!existingClient;
    
    if (exists) {
      console.log(`✅ Telephone ${telephone} exists - Name: ${existingClient.amazina}`);
      res.json({ 
        exists: true,
        clientName: existingClient.amazina
      });
    } else {
      console.log(`✅ Telephone ${telephone} is available`);
      res.json({ 
        exists: false 
      });
    }

  } catch (error) {
    console.error("💥 Telephone check error:", error);
    res.status(500).json({ message: "Ikosa mu kureba telephone!" });
  }
});

// 🟠 Update Client route - UPDATED: With user tracking
app.put("/api/clients/:id", async (req, res) => {
  const clientId = req.params.id;
  console.log(`📥 Updating client ID: ${clientId}`, req.body);
  
  try {
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
    const { data: existingClient, error: checkError } = await supabase
      .from("abonizera")
      .select("id")
      .eq("id", clientId)
      .single();

    if (checkError || !existingClient) {
      console.log("❌ Client not found");
      return res.status(404).json({ message: "Umwizerwa ntaborerwa!" });
    }

    console.log("💾 Updating client in database...");
    
    const { data, error } = await supabase
      .from("abonizera")
      .update({
        amazina: amazina,
        telephone: telephone,
        igicuruzwa: igicuruzwa || "Nta bicuruzwa",
        amafaranga: amafaranga || "0",
      })
      .eq("id", clientId)
      .select();

    if (error) {
      console.log("❌ Database update error:", error);
      return res.status(500).json({ message: "Ikosa mu guhindura umwizerwa!" });
    }

    console.log("✅ Client updated successfully");
    res.json({ 
      message: "Umwizerwa wahinduwe neza!", 
      client: data ? data[0] : null 
    });

  } catch (error) {
    console.error("💥 Client update error:", error);
    res.status(500).json({ message: "Ikosa mu guhindura umwizerwa!" });
  }
});

// 🔴 DELETE CLIENT PRODUCT route
app.delete("/api/clients/product/:id", async (req, res) => {
  const productId = req.params.id;
  console.log(`📥 Deleting product ID: ${productId}`);
  
  try {
    console.log("🔍 Checking if product exists...");
    const { data: existingProduct, error: checkError } = await supabase
      .from("abonizera")
      .select("id")
      .eq("id", productId)
      .single();

    if (checkError || !existingProduct) {
      console.log("❌ Product not found");
      return res.status(404).json({ message: "Igicuruzwa ntibonetse!" });
    }

    console.log("🗑️ Deleting product from database...");
    
    const { error } = await supabase
      .from("abonizera")
      .delete()
      .eq("id", productId);

    if (error) {
      console.log("❌ Database delete error:", error);
      return res.status(500).json({ message: "Ikosa mu gusiba igicuruzwa!" });
    }

    console.log("✅ Product deleted successfully");
    res.json({ 
      message: "Igicuruzwa cyasibwe neza!"
    });

  } catch (error) {
    console.error("💥 Product delete error:", error);
    res.status(500).json({ message: "Ikosa mu gusiba igicuruzwa!" });
  }
});

// 🔴 Delete Client route (deletes all products for this telephone)
app.delete("/api/clients/:telephone", async (req, res) => {
  const telephone = req.params.telephone;
  console.log(`📥 Deleting all products for client: ${telephone}`);
  
  try {
    console.log("🔍 Checking if client exists...");
    const { data: existingClient, error: checkError } = await supabase
      .from("abonizera")
      .select("id, amazina")
      .eq("telephone", telephone);

    if (checkError || !existingClient || existingClient.length === 0) {
      console.log("❌ Client not found");
      return res.status(404).json({ message: "Nta mwizerwa ufite telephone iyo!" });
    }

    console.log(`🗑️ Deleting ${existingClient.length} products for: ${existingClient[0].amazina}`);
    
    const { error } = await supabase
      .from("abonizera")
      .delete()
      .eq("telephone", telephone);

    if (error) {
      console.log("❌ Database delete error:", error);
      return res.status(500).json({ message: "Ikosa mu gusiba umwizerwa!" });
    }

    console.log("✅ Client and all products deleted successfully");
    res.json({ 
      message: "Umwizerwa n'ibicuruzwa byasibwe neza!"
    });

  } catch (error) {
    console.error("💥 Client delete error:", error);
    res.status(500).json({ message: "Ikosa mu gusiba umwizerwa!" });
  }
});

// 🟡 Get Client Statistics route - UPDATED: Better statistics
app.get("/api/clients/stats", async (req, res) => {
  console.log("📥 Fetching client statistics");
  
  try {
    const { data: clients, error } = await supabase
      .from("abonizera")
      .select("amafaranga, telephone");

    if (error) {
      console.log("❌ Database stats error:", error);
      return res.status(500).json({ message: "Ikosa mu kubona statistics!" });
    }

    const uniqueTelephones = new Set(clients?.map(client => client.telephone) || []);
    const totalClients = uniqueTelephones.size;
    const totalProducts = clients?.length || 0;
    const totalDebt = clients?.reduce((sum, client) => {
      return sum + (parseInt(client.amafaranga) || 0);
    }, 0) || 0;

    console.log(`✅ Statistics: ${totalClients} clients, ${totalProducts} products, ${totalDebt} RWF`);
    res.json({ 
      totalClients,
      totalProducts,
      totalDebt
    });

  } catch (error) {
    console.error("💥 Statistics fetch error:", error);
    res.status(500).json({ message: "Ikosa mu kubona statistics!" });
  }
});

// 🟢 Get User Activity Log route - UPDATED: With complete user info
app.get("/api/user-activity/:userId", async (req, res) => {
  const userId = req.params.userId;
  console.log(`📥 Fetching activity for user: ${userId}`);
  
  try {
    const { data: activities, error } = await supabase
      .from("abonizera")
      .select(`
        *,
        users:created_by (amazina, telephone)
      `)
      .eq("created_by", userId)
      .order("created_at", { ascending: false });

    if (error) {
      console.log("❌ Database fetch error:", error);
      return res.status(500).json({ message: "Ikosa mu kubona ibikorwa!" });
    }

    // Enhance activities with creator information
    const enhancedActivities = activities?.map(activity => ({
      ...activity,
      createdBy: activity.created_by,
      creatorName: activity.creator_name || activity.users?.amazina || "System",
      creatorTelephone: activity.creator_telephone || activity.users?.telephone
    })) || [];

    console.log(`✅ Retrieved ${enhancedActivities.length} activities for user ${userId}`);
    res.json({ 
      message: "Ibyakera byawe bibaswe neza!", 
      activities: enhancedActivities 
    });

  } catch (error) {
    console.error("💥 User activity fetch error:", error);
    res.status(500).json({ message: "Ikosa mu kubona ibikorwa!" });
  }
});

// Health check route
app.get("/api/health", (req, res) => {
  res.json({ 
    message: "Server irakora neza!", 
    timestamp: new Date().toISOString()
  });
});

// Test database connection and table structure
app.get("/api/test-db", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .limit(1);
    
    if (error) {
      if (error.code === '42P01') {
        return res.status(500).json({ 
          message: "Table 'users' itariho!",
          solution: "Gukora table 'users' muri Supabase" 
        });
      }
      throw error;
    }
    
    res.json({ 
      message: "Database connection successful",
      table_exists: true,
      columns: data.length > 0 ? Object.keys(data[0]) : ['Table is empty']
    });
  } catch (error) {
    res.status(500).json({ 
      message: "Database connection failed",
      error: error.message 
    });
  }
});

// Test abonizera table connection
app.get("/api/test-clients", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('abonizera')
      .select('*')
      .limit(1);
    
    if (error) {
      if (error.code === '42P01') {
        return res.status(500).json({ 
          message: "Table 'abonizera' itariho!",
          solution: "Gukora table 'abonizera' muri Supabase" 
        });
      }
      throw error;
    }
    
    res.json({ 
      message: "Abonizera table connection successful",
      table_exists: true,
      columns: data.length > 0 ? Object.keys(data[0]) : ['Table is empty']
    });
  } catch (error) {
    res.status(500).json({ 
      message: "Abonizera table connection failed",
      error: error.message 
    });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`🌐 Health check: http://localhost:${PORT}/api/health`);
  console.log(`👥 Users test: http://localhost:${PORT}/api/test-db`);
  console.log(`📋 Clients test: http://localhost:${PORT}/api/test-clients`);
  console.log(`\n📊 Available Client Routes:`);
  console.log(`   POST   /api/clients - Add new client/product`);
  console.log(`   POST   /api/clients/add-product - Add product to existing client`);
  console.log(`   GET    /api/clients - Get all clients`);
  console.log(`   GET    /api/my-clients/:userId - Get user's clients only`);
  console.log(`   GET    /api/cross-user-clients/:userTelephone - Get clients for cross-user tracking`);
  console.log(`   GET    /api/abanyizera/:userTelephone - Get optimized abanyizera data`);
  console.log(`   GET    /api/clients/:id - Get client details by ID`);
  console.log(`   GET    /api/clients/telephone/:telephone - Get client by telephone`);
  console.log(`   GET    /api/clients/check-telephone/:telephone - Check telephone exists`);
  console.log(`   PUT    /api/clients/:id - Update client`);
  console.log(`   DELETE /api/clients/product/:id - Delete product`);
  console.log(`   DELETE /api/clients/:telephone - Delete client and all products`);
  console.log(`   GET    /api/clients/stats - Get client statistics`);
  console.log(`   GET    /api/user-activity/:userId - Get user activity log`);
  console.log(`\n👤 User Routes:`);
  console.log(`   POST   /api/signup - User registration`);
  console.log(`   POST   /api/login - User login`);
  console.log(`   POST   /api/forgot-password - Forgot password`);
  console.log(`   POST   /api/reset-password - Reset password`);
});