/**
 * @file app.js
 * @brief This file contains the main application logic for the health monitoring system.
 */

const express = require('express');
const session = require('express-session');
const bcrypt = require('bcrypt');
const sqlite3 = require('sqlite3').verbose();
const mqttClient = require('./mqttClient.js');
const { PythonShell } = require('python-shell');
const path = require('path');
const { spawn } = require('child_process');
const cron = require('node-cron');
const { get } = require('http');
const qrCodeReader = require('qrcode-reader');
const jimp = require('jimp');
const QRCode = require('qrcode');
const qrCode = require('qr-image');
const fs = require('fs');
const fileUpload = require('express-fileupload');
const bodyParser = require('body-parser');
const { decode } = require('jsqr');

const app = express();
const db = new sqlite3.Database('../database.db');


/**
 * @brief Creates the users and alerts tables in the SQLite database if they do not exist.
 */
db.serialize(() => {
    db.run('CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT NOT NULL, password TEXT NOT NULL, age INTEGER NOT NULL, gender TEXT NOT NULL, cholesterol INTEGER NOT NULL, chest_pain_type TEXT NOT NULL)');
    db.run('CREATE TABLE IF NOT EXISTS alerts (id INTEGER PRIMARY KEY AUTOINCREMENT, time TEXT, message TEXT, triggered INTEGER DEFAULT 0)');
});
/**
 * @brief Sets the view engine to EJS for rendering views.
 * @details This sets the view engine to EJS, which allows the application to render dynamic content using EJS templates.
 */
app.set('view engine', 'ejs');

/**
 * @brief Middleware to parse URL-encoded bodies.
 * @details This middleware parses incoming requests with URL-encoded payloads and populates the `req.body` object.
 * It is used to handle form submissions where the data is sent as URL-encoded key-value pairs.
 */
app.use(express.urlencoded({ extended: true }));

/**
 * @brief Middleware to parse JSON bodies.
 * @details This middleware parses incoming requests with JSON payloads and populates the `req.body` object.
 * It is used to handle API requests where the data is sent as JSON.
 */
app.use(bodyParser.json());

/**
 * @brief Middleware to parse URL-encoded bodies.
 * @details This middleware parses incoming requests with URL-encoded payloads and populates the `req.body` object.
 * It is used to handle form submissions where the data is sent as URL-encoded key-value pairs.
 */
app.use(bodyParser.urlencoded({ extended: false }));

/**
 * @brief Middleware for managing sessions.
 * @details This middleware creates a session for each client and stores session data in memory.
 * It uses a secret key to encrypt session data and prevent tampering.
 */
app.use(session({ secret: 'secret', resave: false, saveUninitialized: false }));

/**
 * @brief Middleware to set the userId in local variables.
 * @details This middleware sets the userId from the session to a local variable `userId` in the response object.
 * It allows the userId to be accessed in views without explicitly passing it in every render call.
 */
app.use((req, res, next) => {
    res.locals.userId = req.session.userId;
    next();
});

// Routes

/**
 * Renders the signup form.
 * @function
 * @name GET/signup
 * @memberof app
 * @param {Express.Request} req - The request object.
 * @param {Express.Response} res - The response object.
 * @returns {void}
 * @example
 * // Request
 * GET /signup
 * // Response
 * Renders the 'signup' view template with no error message.
 */
app.get('/signup', (req, res) => {
    res.render('signup', { error: null });
});

/**
 * Handles user signup.
 * @function
 * @name POST/signup
 * @memberof app
 * @param {Express.Request} req - The request object.
 * @param {Express.Response} res - The response object.
 * @returns {void}
 * @throws {Error} If an error occurs while signing up.
 * @example
 * // Request body
 * {
 *   "name": "John Doe",
 *   "email": "john.doe@example.com",
 *   "password": "password123",
 *   "age": 30,
 *   "gender": "male",
 *   "cholesterol": 200,
 *   "chest_pain_type": "typical angina",
 *   "health_consent": true
 * }
 * // Response
 * Redirects to the login page if signup is successful.
 * Renders the 'signup' view template with an error message if the email already exists.
 */
app.post('/signup', async (req, res) => {
    try {
        // Assuming req.body is the object containing form data
        console.log(req.body.health_consent);
        const data = {};
        if (req.body.health_consent) {
            for (const key in req.body) {
                if (Array.isArray(req.body[key])) {
                    data[key] = req.body[key][0]; // Use the second element of the array
                } else {
                    data[key] = req.body[key]; // Use the value as is
                }
            }
        } else {
            for (const key in req.body) {
                if (Array.isArray(req.body[key])) {
                    data[key] = req.body[key][1]; // Use the second element of the array
                } else {
                    data[key] = req.body[key]; // Use the value as is
                }
            }
        }

        console.log(data);

        // Check if the email already exists in the database
        db.get('SELECT * FROM users WHERE email = ?', [data.email], async (err, row) => {
            if (err) {
                console.error(err);
                return res.status(500).send('An error occurred while checking email existence');
            }
            if (row) {
                return res.render('signup', { error: 'email already exists' }); // email already exists, render signup page with error message
            }

            const hashedPassword = await bcrypt.hash(data.password.toString(), 10);
            // Check if cholesterol and chest_pain_type are provided, otherwise set them to NULL
            if (data.cholesterol == undefined) {
                data.cholesterol = 0;
                data.chest_pain_type = 0;
            }
            // Insert the user into the database
            db.run('INSERT INTO users (name, email, password, age, gender, cholesterol, chest_pain_type, loginFirstTime) VALUES (?, ?, ?, ?, ?, ?, ?, 1)', [data.name, data.email, hashedPassword, data.age, data.gender, data.cholesterol, data.chest_pain]);
            res.redirect('/login');
        });
    } catch (error) {
        console.error(error);
        res.status(500).send('An error occurred while signing up');
    }
});
/**
 * Redirects to the login page.
 * @function
 * @name GET/
 * @memberof app
 * @param {Express.Request} req - The request object.
 * @param {Express.Response} res - The response object.
 * @returns {void}
 * @example
 * // Redirects to the login page.
 */
app.get('/', (req, res) => {
    res.redirect('/login');
});

/**
 * Renders the login form.
 * @function
 * @name GET/login
 * @memberof app
 * @param {Express.Request} req - The request object.
 * @param {Express.Response} res - The response object.
 * @returns {void}
 * @example
 * // Renders the login form.
 */
app.get('/login', (req, res) => {
    res.render('login', { error: null });
});

/**
 * Handles user login.
 * @function
 * @name POST/login
 * @memberof app
 * @param {Express.Request} req - The request object.
 * @param {Express.Response} res - The response object.
 * @returns {void}
 * @example
 * // Handles user login.
 */
app.post('/login', async (req, res) => {
    const { email, password } = req.body;

    db.get('SELECT * FROM users WHERE email = ?', [email], async (err, row) => {
        if (err) {
            console.error(err);
            return res.status(500).send('An error occurred');
        }
        if (!row) {
            return res.render('login', { error: 'Invalid email or password' }); // Pass the error message
        }
        const validPassword = await bcrypt.compare(password, row.password.toString());
        if (!validPassword) {
            return res.render('login', { error: 'Password is Wrong' }); // Pass the error message
        }
        req.session.userId = row.id;

        // Check if the user is logging in for the first time
        if (row.loginFirstTime === 1) {
            // Update the loginFirstTime column to false
            db.run('UPDATE users SET loginFirstTime = 0 WHERE id = ?', [row.id], (updateErr) => {
                if (updateErr) {
                    console.error(updateErr);
                    return res.status(500).send('An error occurred while updating user data');
                }
                res.redirect('/scan-qr-code'); // Redirect to scan QR code page
            });
        } else {
            res.cookie('loggedIn', 'true', { maxAge: 30 * 60 * 1000 });
            res.redirect('/dashboard');
        }
    });
});
/**
 * Middleware that requires authentication.
 * @param {import('express').Request} req - The Express request object.
 * @param {import('express').Response} res - The Express response object.
 * @param {import('express').NextFunction} next - The next middleware function in the stack.
 */
function requireAuth(req, res, next) {
    if (req.session && req.session.userId) {
        return next();
    }
    res.redirect('/login');
}

/**
 * Middleware function to set the email in res.locals if the user is authenticated.
 * Sets email to null if the user is not authenticated or if an error occurs.
 * @param {import('express').Request} req - The Express request object.
 * @param {import('express').Response} res - The Express response object.
 * @param {import('express').NextFunction} next - The next middleware function in the stack.
 */
app.use((req, res, next) => {
    if (req.session && req.session.userId) {
        db.get('SELECT email FROM users WHERE id = ?', [req.session.userId], (err, row) => {
            if (err) {
                console.error(err);
                return next(err);
            }
            if (!row) {
                res.locals.email = null; // Set email to null if user not found
            } else {
                res.locals.email = row.email;
            }
            next();
        });
    } else {
        console.log('No user session');
        res.locals.email = null; // Set email to null if no user session
        next();
    }
});

/**
 * Route that renders the dashboard.
 * @param {import('express').Request} req - The Express request object.
 * @param {import('express').Response} res - The Express response object.
 */
app.get('/dashboard', requireAuth, (req, res) => {
    res.render('dashboard');
});

/**
 * Route that renders the scan QR code page.
 * @param {import('express').Request} req - The Express request object.
 * @param {import('express').Response} res - The Express response object.
 */
app.get('/scan-qr-code', (req, res) => {
    res.render('scan-qr-code', { errorMessage: null });
});

/**
 * Route that handles the POST request to scan a QR code.
 * @param {import('express').Request} req - The Express request object.
 * @param {import('express').Response} res - The Express response object.
 */
app.post('/scan-qr-code', (req, res) => {
    if (!req.files || !req.files.qrCodeImage) {
        return res.status(400).send('No files were uploaded.');
    }

    const qrCodeImage = req.files.qrCodeImage;

    // Save the uploaded image to a temporary file
    const tempImagePath = `${__dirname}/temp/${qrCodeImage.name}`;
    qrCodeImage.mv(tempImagePath, (err) => {
        if (err) {
            console.error(err); // Log the error
            return res.status(500).send('Failed to save uploaded file.');
        }

        // Read the temporary image file and decode the QR code
        fs.readFile(tempImagePath, (err, data) => {
            if (err) {
                console.error(err); // Log the error
                return res.status(500).send('Failed to read uploaded file.');
            }

            // Decode the QR code image
            const qr = new qrCodeReader();
            qr.callback = (err, value) => {
                if (err) {
                    console.error(err); // Log the error
                    return res.status(500).send('Failed to decode QR code.');
                }
                if (value) {
                    const decodedText = value.result;
                    console.log(decodedText);

                    // Check if the decoded text matches the expected pattern
                    const pattern = /^mqtt:\/\/\d+\.\d+\.\d+\.\d+:\d+$/;
                    if (pattern.test(decodedText)) {
                        console.log("hii")
                      
                        // Redirect to the dashboard page if the pattern matches
                        res.redirect('/dashboard');
                    } else {
                        // Render the scan-qr-code page with an error message
                        res.render('scan-qr-code', { errorMessage: 'Invalid QR code format.' });
                    }
                } else {
                    // Render the scan-qr-code page with an error message
                    res.render('scan-qr-code', { errorMessage: 'No QR code found in the image.' });
                }
            };
            jimp.read(data, (err, image) => {
                if (err) {
                    console.error(err); // Log the error
                    return res.status(500).send('Failed to read image.');
                }
                qr.decode(image.bitmap);
            });
        });
    });
});
/**
 * Route that fetches dashboard data.
 * @param {import('express').Request} req - The Express request object.
 * @param {import('express').Response} res - The Express response object.
 */
app.get('/dashboard-data', requireAuth, (req, res) => {
    db.get('SELECT age, gender,cholesterol,chest_pain_type FROM users WHERE id = ?', [req.session.userId], (err, userRow) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ error: 'An error occurred while fetching user data' });
        }

        // Query the SQLite database for the latest data from each sensor
        db.get('SELECT * FROM s_data ORDER BY id DESC LIMIT 1', (err, row) => {
            if (err) {
                console.error(err);
                return res.status(500).send('An error occurred');
            }

            // Prepare the data to send to the dashboard
            const data = {
                heartsensor: null,
                bp: null,
                chol: null
            };
            if (row) {
                data.heartsensor = row.heartsensor;
                data.bp = row.bp;
                
            }

            // Load the ML model
            let form_data = {
                age: userRow.age,
                trestbps: data.bp,
                thalch: data.heartsensor,
                sex: userRow.gender
            };

            let pythonFileName;
            if (userRow.cholesterol == 0) {
                console.log("ifffffffffffff")
                pythonFileName = 'smartdatanor.py'; // Python script for 'o' value
            } else {
                console.log("elsseeeese")
                pythonFileName = 'smartdata.py'; // Python script for other values
                form_data = { ...form_data,  chol: userRow.cholesterol,cp: userRow.chest_pain_type }; // Adjust form_data for other values
            }

            const pythonProcess = spawn('python', [pythonFileName, JSON.stringify(form_data)]);
            console.log('Python process spawned');
            console.log(form_data);

            pythonProcess.stdout.on('data', (data) => {
                console.log('Received data from Python process');
                const predictions = JSON.parse(data);
                console.log('Prediction:', predictions);

                if (predictions.alert_prediction === 'False') {
                    res.status(200).json({ message: 'Something is wrong. Please consult a doctor.' });
                } else {
                    res.status(200).json(data);
                }
            });

           
        });

    });
});

/**
 * Route to handle the GET request for rendering the graph page.
 * Queries the SQLite database for the latest heartbeat data.
 * @param {import('express').Request} req - The Express request object.
 * @param {import('express').Response} res - The Express response object.
 */
app.get('/graph', (req, res) => {
     // Query the SQLite database for the latest heartbeat data
     db.all('SELECT * FROM s_data WHERE heartsensor IS NOT NULL ORDER BY timestamp DESC LIMIT 100', (err, rows) => {
        if (err) {
            console.error(err);
            return res.status(500).send('An error occurred while fetching data');
        }
        console.log(rows);
        // Render the 'index' template and pass the data for the chart
        res.render('graph', { rows });
    });
});
/**
 * Route that renders the profile page.
 * @param {import('express').Request} req - The Express request object.
 * @param {import('express').Response} res - The Express response object.
 */
app.get('/profile', requireAuth, (req, res) => {
    db.get('SELECT * FROM users WHERE id = ?', [req.session.userId], (err, row) => {
        if (err) {
            console.error(err);
            return res.status(500).send('An error occurred while fetching user data');
        }
        if (!row) {
            return res.status(404).send('User not found');
        }
        res.render('profile', {name:row.name, email: row.email, age: row.age, gender: row.gender ,cholesterol:row.cholesterol});
        
    });
});

/**
 * Route that logs out the user.
 * @param {import('express').Request} req - The Express request object.
 * @param {import('express').Response} res - The Express response object.
 */
app.get('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            console.error(err);
            return res.status(500).send('An error occurred');
        }
        res.clearCookie('loggedIn'); // Clear the login cookie
        res.redirect('/login');
    });
});
/**
 * Cron job to check for alerts that need to be triggered at the current time
 * and publish them using MQTT.
 * @param {string} pattern - A cron time pattern for when to execute the job.
 * @param {Function} callback - The callback function to execute when the job runs.
 * @returns {CronJob} - The created cron job instance.
 */
cron.schedule('* * * * *', () => {
    console.log("cron")
    const now = new Date().toISOString().substr(11, 5); // Get current time in HH:mm format
    console.log(now)
    db.all('SELECT * FROM alerts WHERE time = ? AND triggered = 0', [now], (err, rows) => {
        if (err) {
            console.error(err);
            return;
        }
        rows.forEach(row => {
            // Send MQTT command
            client.publish('alert', row.message);
            // Mark alert as triggered
            db.run('UPDATE alerts SET triggered = 1 WHERE id = ?', [row.id]);
        });
    });
});

/**
 * Route handler for creating an alert.
 * Inserts a new alert with the specified time and message into the database.
 * Redirects to the '/create-alert' page after insertion.
 * @param {Request} req - The Express Request object.
 * @param {Response} res - The Express Response object.
 */
app.post('/create-alert', (req, res) => {
    const { time, message } = req.body;
    console.log(time)
    db.run('INSERT INTO alerts (time, message) VALUES (?, ?)', [time, message], (err) => {
        if (err) {
            console.error(err);
            return res.status(500).send('An error occurred');
        }
        res.redirect('/create-alert');
    });
});
/**
 * Route handler for rendering the create-alert page.
 * Fetches all alerts from the database and renders the 'create-alert' template with the alerts data.
 * @param {Request} req - The Express Request object.
 * @param {Response} res - The Express Response object.
 */
app.get('/create-alert', (req, res) => {
    db.all('SELECT * FROM alerts', (err, rows) => {
        if (err) {
            console.error(err);
            return res.status(500).send('An error occurred while fetching alerts');
        }
        res.render('create-alert', { alerts: rows });
    });
});

/**
 * Route handler for deleting an alert by ID.
 * Deletes the alert with the specified ID from the database.
 * @param {Request} req - The Express Request object.
 * @param {Response} res - The Express Response object.
 */
app.post('/delete-alert/:id', (req, res) => {
    const { id } = req.params;
    db.run('DELETE FROM alerts WHERE id = ?', [id], (err) => {
        if (err) {
            console.error(err);
            return res.status(500).send('An error occurred while deleting alert');
        }
        res.redirect('/create-alert');
    });
});






// Start the server
/**
 * Starts the server on the specified port.
 * @param {number} port - The port number to listen on.
 * @param {function} callback - The callback function to execute once the server is running.
 */
function startServer(port, callback) {
    app.listen(port, callback);
}

// Example usage
const PORT = 3000;
startServer(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
