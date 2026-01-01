CREATE DATABASE pharmacy;
use pharmacy 
CREATE TABLE wholesalers (
  wholesaler_id VARCHAR(36) PRIMARY KEY NOT NULL UNIQUE,
  name VARCHAR(100) NOT NULL,
  address VARCHAR(100) NOT NULL,
  username VARCHAR(100) NOT NULL UNIQUE,
  password VARCHAR(255) NOT NULL,
  status VARCHAR(100) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE  products (
  product_id VARCHAR(100) PRIMARY KEY NOT NULL,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  price DECIMAL(10,2) NOT NULL,
  quantity INT NOT NULL,
  expire_date DATE,
  wholesaler_id VARCHAR(36) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_price_update TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (wholesaler_id) REFERENCES wholesalers(wholesaler_id) ON DELETE CASCADE
);

CREATE TABLE pharmacy (
pharmacy_id VARCHAR(100) PRIMARY KEY NOT NULL,
name VARCHAR(100) NOT NULL,
address VARCHAR(100) NOT NULL,
phone_No Varchar(100) NOT NULL,
username VARCHAR(100) NOT NULL UNIQUE,
password VARCHAR(255) NOT NULL,
status VARCHAR(100) NOT NULL,
created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE admins (
  admin_id VARCHAR(36) PRIMARY KEY NOT NULL UNIQUE,
  name VARCHAR(100) NOT NULL,
  username VARCHAR(100) NOT NULL UNIQUE,
  password VARCHAR(255) NOT NULL,
  email VARCHAR(100),
  role VARCHAR(50) DEFAULT 'admin',
  status VARCHAR(50) DEFAULT 'active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE request (
request_id VARCHAR(100) PRIMARY KEY NOT NULL,
product_name VARCHAR(250) NOT NULL,
quantity INT NOT NULL,
order_date DATE NOT NULL,
status VARCHAR(100) NOT NULL,
pharmacy_id VARCHAR(100) NOT NULL,
wholesaler_id VARCHAR(36) NOT NULL,
order_id VARCHAR(100) NULL,
notification_sent BOOLEAN DEFAULT FALSE,
notification_message TEXT NULL,
FOREIGN KEY (pharmacy_id) REFERENCES pharmacy(pharmacy_id) ON DELETE CASCADE,
FOREIGN KEY (wholesaler_id) REFERENCES wholesalers(wholesaler_id) ON DELETE CASCADE
);

CREATE TABLE notifications (
  notification_id VARCHAR(36) PRIMARY KEY,
  recipient_id VARCHAR(36) NOT NULL,
  recipient_role ENUM('wholesaler','pharmacy','admin') NOT NULL,
  message TEXT NOT NULL,
  type VARCHAR(50) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  is_read BOOLEAN DEFAULT FALSE
);


