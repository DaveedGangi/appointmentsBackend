const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bodyParser = require('body-parser');
const path = require('path');

const app = express();
app.use(bodyParser.json());

// Connect to SQLite database using the sessions.db file
const dbPath = path.join(__dirname, 'sessions.db');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error opening database', err);
    } else {
        console.log('Connected to the sessions.db database.');
    }
});

// Initialize tables if they don't exist
db.serialize(() => {
    // Mentors table with expertise and premium status
    db.run(`CREATE TABLE IF NOT EXISTS Mentors (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        expertise TEXT NOT NULL,
        premium BOOLEAN NOT NULL
    )`);

    // Appointments table
    db.run(`CREATE TABLE IF NOT EXISTS Appointments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        mentor_id INTEGER,
        student_id INTEGER,
        date TEXT NOT NULL,
        start_time TEXT NOT NULL,
        end_time TEXT NOT NULL,
        duration INTEGER NOT NULL,
        FOREIGN KEY (mentor_id) REFERENCES Mentors(id)
    )`);

    // Students table with area_of_interest
    db.run(`CREATE TABLE IF NOT EXISTS Students (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        area_of_interest TEXT NOT NULL
    )`);

    // Payments table
    db.run(`CREATE TABLE IF NOT EXISTS Payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        student_id INTEGER,
        mentor_id INTEGER,
        duration INTEGER,
        amount INTEGER,
        appointment_id INTEGER,
        FOREIGN KEY (student_id) REFERENCES Students(id),
        FOREIGN KEY (mentor_id) REFERENCES Mentors(id),
        FOREIGN KEY (appointment_id) REFERENCES Appointments(id)
    )`);
});

// Function to check availability
function checkAvailability(mentor_id, date, start_time, end_time, callback) {
    db.get(
        `SELECT * FROM Appointments WHERE mentor_id = ? AND date = ? AND
        ((start_time < ? AND end_time > ?) OR (start_time < ? AND end_time > ?) OR
        (start_time >= ? AND end_time <= ?))`,
        [mentor_id, date, end_time, start_time, start_time, end_time, start_time, end_time],
        (err, row) => {
            if (err) {
                console.error(err);
                callback(false);
            } else {
                callback(!row);
            }
        }
    );
}

// Function to update mentor's availability (simplified)
function updateMentorAvailability(mentor_id, date, start_time, end_time) {
    console.log(`Mentor ${mentor_id}'s availability on ${date} updated: ${start_time} - ${end_time}`);
}

// Route to book an appointment with payment
app.post('/book-appointment', (req, res) => {
    const { student_id, mentor_id, date, start_time, duration, amount } = req.body;

    // Fetch student area of interest
    db.get(`SELECT area_of_interest FROM Students WHERE id = ?`, [student_id], (err, student) => {
        if (err || !student) {
            return res.status(400).send('Student not found');
        }

        // Fetch mentor expertise and premium status
        db.get(`SELECT expertise, premium FROM Mentors WHERE id = ?`, [mentor_id], (err, mentor) => {
            if (err || !mentor) {
                return res.status(400).send('Mentor not found');
            }

            // Parse mentor expertise (assuming JSON stored as text)
            const expertise = JSON.parse(mentor.expertise);

            // Check if mentor's expertise matches student's area of interest
            if (!expertise.includes(student.area_of_interest)) {
                return res.status(400).send('Mentor does not have expertise in the student\'s area of interest');
            }

            // Additional logic for premium mentors could be added here
            if (mentor.premium) {
                console.log(`Mentor ${mentor_id} is a premium mentor.`);
                // Handle premium-specific logic if needed
            }

            // Calculate end time based on duration
            let startTime = new Date(`${date}T${start_time}`);
            let endTime = new Date(startTime);
            endTime.setMinutes(startTime.getMinutes() + duration);

            const formattedStartTime = startTime.toTimeString().substring(0, 5);
            const formattedEndTime = endTime.toTimeString().substring(0, 5);

            // Check availability
            checkAvailability(mentor_id, date, formattedStartTime, formattedEndTime, (available) => {
                if (available) {
                    // Book the appointment
                    db.run(
                        `INSERT INTO Appointments (student_id, mentor_id, date, start_time, end_time, duration) 
                         VALUES (?, ?, ?, ?, ?, ?)`,
                        [student_id, mentor_id, date, formattedStartTime, formattedEndTime, duration],
                        function (err) {
                            if (err) {
                                return res.status(500).send('Error booking appointment');
                            }

                            const appointmentId = this.lastID;

                            // Insert payment record
                            db.run(
                                `INSERT INTO Payments (student_id, mentor_id, duration, amount, appointment_id) 
                                 VALUES (?, ?, ?, ?, ?)`,
                                [student_id, mentor_id, duration, amount, appointmentId],
                                function (err) {
                                    if (err) {
                                        return res.status(500).send('Error processing payment');
                                    }

                                    // Update mentor's availability
                                    updateMentorAvailability(mentor_id, date, formattedStartTime, formattedEndTime);

                                    res.status(200).send('Appointment booked and payment processed successfully');
                                }
                            );
                        }
                    );
                } else {
                    res.status(400).send('Time slot not available');
                }
            });
        });
    });
});

// Sample route to add mentors with expertise and premium status (for testing)
app.post('/add-mentor', (req, res) => {
    const { name, expertise, premium } = req.body; // expertise is expected to be an array
    db.run(`INSERT INTO Mentors (name, expertise, premium) VALUES (?, ?, ?)`, [name, JSON.stringify(expertise), premium], function (err) {
        if (err) {
            return res.status(500).send('Error adding mentor');
        }
        res.status(200).send({ id: this.lastID, name, expertise, premium });
    });
});

// Sample route to add students with area_of_interest (for testing)
app.post('/add-student', (req, res) => {
    const { name, area_of_interest } = req.body;
    db.run(`INSERT INTO Students (name, area_of_interest) VALUES (?, ?)`, [name, area_of_interest], function (err) {
        if (err) {
            return res.status(500).send('Error adding student');
        }
        res.status(200).send({ id: this.lastID, name, area_of_interest });
    });
});

// Get all appointments
app.get('/appointments', (req, res) => {
    db.all(`SELECT * FROM Appointments`, (err, rows) => {
        if (err) {
            return res.status(500).send('Error fetching appointments');
        }
        res.status(200).send(rows);
    });
});

// Get all payments 
app.get('/payments', (req, res) => {
    db.all(`SELECT * FROM Payments`, (err, rows) => {
        if (err) {
            return res.status(500).send('Error fetching payments');
        }
        res.status(200).send(rows);
    });
});

// delete all appointments

app.delete('/appointments', (req, res) => {
    db.run(`DELETE FROM Appointments`, (err) => {
        if (err) {
            return res.status(500).send('Error deleting appointments');
        }
        res.status(200).send('Appointments deleted successfully');
    });
});

// delete all payments

app.delete('/payments', (req, res) => {
    db.run(`DELETE FROM Payments`, (err) => {
        if (err) {
            return res.status(500).send('Error deleting payments');
        }
        res.status(200).send('Payments deleted successfully');
    });
});

// get all mentors

app.get('/mentors', (req, res) => {
    db.all(`SELECT * FROM Mentors`, (err, rows) => {
        if (err) {
            return res.status(500).send('Error fetching mentors');
        }
        res.status(200).send(rows);
    });
});

// get all students

app.get('/students', (req, res) => {
    db.all(`SELECT * FROM Students`, (err, rows) => {
        if (err) {
            return res.status(500).send('Error fetching students');
        }
        res.status(200).send(rows);
    });
});

// delete a mentor

app.delete('/mentors/:id', (req, res) => {
    const id = parseInt(req.params.id);
    db.run(`DELETE FROM Mentors WHERE id =?`, [id], (err) => {
        if (err) {
            return res.status(500).send('Error deleting mentor');
        }
        res.status(200).send('Mentor deleted successfully');
    });
});

// delete a student

app.delete('/students/:id', (req, res) => {
    const id = parseInt(req.params.id);
    db.run(`DELETE FROM Students WHERE id =?`, [id], (err) => {
        if (err) {
            return res.status(500).send('Error deleting student');
        }
        res.status(200).send('Student deleted successfully');
    });
});

// delete all students

app.delete('/students', (req, res) => {
    db.run(`DELETE FROM Students`, (err) => {
        if (err) {
            return res.status(500).send('Error deleting students');
        }
        res.status(200).send('Students deleted successfully');
    });
});

// delete all mentors

app.delete('/mentors', (req, res) => {
    db.run(`DELETE FROM Mentors`, (err) => {
        if (err) {
            return res.status(500).send('Error deleting mentors');
        }
        res.status(200).send('Mentors deleted successfully');
    });
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
