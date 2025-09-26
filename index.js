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


app.use(fileUpload());

db.serialize(() => {
    db.run('CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT NOT NULL, password TEXT NOT NULL, age INTEGER NOT NULL, gender TEXT NOT NULL, cholesterol INTEGER NOT NULL, chest_pain_type TEXT NOT NULL)');
});


db.serialize(() => {
    db.run('CREATE TABLE IF NOT EXISTS alerts (id INTEGER PRIMARY KEY AUTOINCREMENT, time TEXT, message TEXT, triggered INTEGER DEFAULT 0)');
});


app.set('view engine', 'ejs');
app.use(express.urlencoded({ extended: true }));
// Parse application/x-www-form-urlencoded
app.use(bodyParser.urlencoded({ extended: false }));

// Parse application/json
app.use(bodyParser.json());

app.use(session({ secret: 'secret', resave: false, saveUninitialized: false }));
app.use((req, res, next) => {
    res.locals.userId = req.session.userId;
    next();
});

app.get('/signup', (req, res) => {
    res.render('signup', { error: null });
});

app.post('/signup', async (req, res) => {
    try {
        // Assuming req.body is the object containing form data
        console.log(req.body.health_consent)
        const data = {};
        if(req.body.health_consent){
            for (const key in req.body) {
                if (Array.isArray(req.body[key])) {
                    data[key] = req.body[key][0]; // Use the second element of the array
                } else {
                    data[key] = req.body[key]; // Use the value as is
                }
            }
        }
        else{
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



app.get('/', (req, res) => {
    res.redirect('/login');
});

app.get('/login', (req, res) => {
    res.render('login', { error: null }); // Pass the error variable with a default value of null
});

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





function requireAuth(req, res, next) {
    if (req.session && req.session.userId) {
        return next();
    }
    res.redirect('/login');
}

app.use((req, res, next) => {
    if (req.session && req.session.userId) {
        db.get('SELECT email FROM users WHERE id = ?', [req.session.userId], (err, row) => {
            if (err) {
                console.error(err);
                return next(err);
            }
            if (!row) {
                // console.log('User not found');
                res.locals.email = null; // Set email to null if user not found
            } else {
                // console.log(row);
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
// 
app.get('/dashboard', requireAuth, (req, res) => {
    // Query the SQLite database for the latest data from each sensor
   
        res.render('dashboard');
    
});
app.get('/scan-qr-code', (req, res) => {
    res.render('scan-qr-code', { errorMessage: null });
});

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





app.get('/dashboard-data', requireAuth, (req, res) => {
    // Query the SQLite database for the user's age and gender
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

// Schedule to check alerts every minute
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

// Route to handle alert creation
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

app.get('/create-alert', (req, res) => {
    db.all('SELECT * FROM alerts', (err, rows) => {
        if (err) {
            console.error(err);
            return res.status(500).send('An error occurred while fetching alerts');
        }
        res.render('create-alert', { alerts: rows });
    });
});
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


const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});

