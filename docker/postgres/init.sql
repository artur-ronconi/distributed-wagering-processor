-- The main database (wagering) is created by POSTGRES_DB.
-- A separate database keeps integration and concurrency tests away from the app's data.
CREATE DATABASE wagering_test OWNER wagering;
