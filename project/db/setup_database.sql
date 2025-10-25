-- Create the database
CREATE DATABASE IF NOT EXISTS women_safety;

USE women_safety;

-- Create users table
CREATE TABLE IF NOT EXISTS users (
    id INT PRIMARY KEY AUTO_INCREMENT,
    profile_picture VARCHAR(255),
    number VARCHAR(100) NOT NULL,
    email VARCHAR(100) NOT NULL UNIQUE,
    password VARCHAR(255) NOT NULL,
    father_number VARCHAR(15),
    mother_number VARCHAR(15),
    guardian_number VARCHAR(15),
    guardian2_number VARCHAR(15),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- SQL to create `locations` table for the Women Empowerment project
-- Run this in your MySQL server (adjust schema/database as needed)

CREATE TABLE IF NOT EXISTS locations (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  location_name VARCHAR(255) NOT NULL,
  area_img VARCHAR(1024) DEFAULT NULL,
  description TEXT DEFAULT NULL,
  surrounding VARCHAR(1024) DEFAULT NULL,
  rating TINYINT UNSIGNED DEFAULT NULL,
  latitude DECIMAL(10,7) DEFAULT NULL,
  longitude DECIMAL(10,7) DEFAULT NULL,
  created_by INT UNSIGNED DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX (created_by),
  INDEX (latitude),
  INDEX (longitude)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

