/**
 * Cafe Soi's menu, typed out from the café's own PDF menu (Oct 2026), in the
 * café's own sections and with the café's own prices — including dishes it
 * lists twice at two prices (guests ask the café). Only English spellings were
 * corrected (Sandwich, Pepper, Chilli, Omelette, Maggi, Chowmein, Lollipop).
 *
 * The one place the prices live: the /cafe-soi-shantiniketan page reads this
 * list. When the café changes its menu, edit here, bump MENU_UPDATED and the
 * page's lastmod in api-server seo.ts.
 */

export const MENU_UPDATED = '2026-10-29';
/** The café manager's number, as in the arrival pack. */
export const CAFE_PHONE = '+91 98308 36670';
export const CAFE_PHONE_HREF = 'tel:+919830836670';

export type MenuItem = { name: string; price: number };
export type MenuGroup = { title: string; items: MenuItem[] };
export type MenuSection = { id: string; title: string; groups: MenuGroup[] };

export const CAFE_MENU: MenuSection[] = [
  {
    id: 'breakfast',
    title: 'Breakfast',
    groups: [
      {
        title: 'Recommended',
        items: [
          { name: 'Luchi Combo', price: 100 },
          { name: 'Paratha Combo', price: 120 },
          { name: 'Karai Shutir Kachuri Combo', price: 120 },
          { name: 'Chhatur Puri Combo', price: 120 },
          { name: 'Alu Paratha Combo', price: 120 },
        ],
      },
      {
        title: 'Beverages',
        items: [
          { name: 'Tea with Milk', price: 50 },
          { name: 'Coffee with Milk', price: 70 },
          { name: 'Black Coffee', price: 50 },
          { name: 'Green Tea', price: 70 },
          { name: 'Darjeeling Tea', price: 70 },
          { name: 'Black Tea', price: 30 },
        ],
      },
      {
        title: 'Choice',
        items: [
          { name: 'Egg Toast', price: 100 },
          { name: 'French Toast', price: 100 },
          { name: 'Chilli Cheese Toast', price: 100 },
          { name: 'Butter / Jam Toast', price: 60 },
          { name: 'Choice of Eggs', price: 50 },
          { name: 'Mutton Stew', price: 250 },
          { name: 'Chicken Stew', price: 150 },
          { name: 'English Breakfast', price: 300 },
        ],
      },
      {
        title: 'Other attractions',
        items: [
          { name: 'Chicken Saute', price: 150 },
          { name: 'Vegetable Saute', price: 120 },
          { name: 'Chicken Soup with Toast', price: 180 },
          { name: 'Veg Soup with Toast', price: 140 },
          { name: 'Egg Salad', price: 120 },
          { name: 'Corn Flakes with Milk', price: 150 },
          { name: 'Maggi Veg', price: 70 },
          { name: 'Maggi Non-Veg', price: 100 },
          { name: 'Veg Sandwich', price: 100 },
          { name: 'Cheese Sandwich', price: 150 },
          { name: 'Chicken Sandwich', price: 150 },
          { name: 'Club Sandwich', price: 180 },
          { name: 'Bombay Sandwich', price: 120 },
          { name: 'Baked Beans', price: 100 },
          { name: 'Boiled Vegetable', price: 120 },
          { name: 'Hot Dog', price: 100 },
        ],
      },
    ],
  },
  {
    id: 'veg',
    title: 'Main course · Veg',
    groups: [
      {
        title: 'Veg options',
        items: [
          { name: 'Jhuri Alu Vaja', price: 80 },
          { name: 'Bangali Alu Vaja', price: 100 },
          { name: 'Begun Vaja', price: 20 },
          { name: 'Potol Vaja (2 pc)', price: 15 },
          { name: 'Shaak Vaja', price: 60 },
          { name: 'Uchchhe Vaja', price: 80 },
          { name: 'Aloo Fulkopi Vaja', price: 100 },
          { name: 'Bori Vaja', price: 100 },
          { name: 'Goyna Bori Vaja', price: 60 },
          { name: 'Sukto', price: 120 },
          { name: 'Alu Posto', price: 140 },
          { name: 'Mixed Veg', price: 120 },
          { name: 'Dhokar Dalna (2 pc)', price: 120 },
          { name: 'Alu Fulkopi', price: 100 },
          { name: 'Alu Potol', price: 100 },
          { name: 'Bori Lau Ghonto', price: 120 },
          { name: 'Panch Mishali Sabji', price: 120 },
          { name: 'Enchor Narkel', price: 150 },
          { name: 'Butter Paneer', price: 200 },
          { name: 'Palak Paneer', price: 210 },
          { name: 'Motor Paneer', price: 220 },
          { name: 'Moong Daal', price: 100 },
          { name: 'Posto Bora', price: 130 },
          { name: 'Beguni (per pc)', price: 8 },
          { name: 'Veg Tadka', price: 120 },
          { name: 'Alur Dum', price: 100 },
          { name: 'Mochar Ghonto', price: 150 },
          { name: 'Kumro Fuler Bora (2 pc)', price: 30 },
          { name: 'Fulkopir Bora (1 pc)', price: 15 },
          { name: 'Dal Butter Fry', price: 120 },
          { name: 'Veg Daal (Moong)', price: 120 },
          { name: 'Alu Bora (1 pc)', price: 5 },
        ],
      },
    ],
  },
  {
    id: 'non-veg',
    title: 'Main course · Non-veg',
    groups: [
      {
        title: 'Non-veg options',
        items: [
          { name: 'Moosur Daal', price: 100 },
          { name: 'Muri Ghonto', price: 150 },
          { name: 'Echor Chingri', price: 180 },
          { name: 'Chingrir Bora (8 pc)', price: 150 },
          { name: 'Egg Kosha (2 pc)', price: 90 },
          { name: 'Egg Curry (2 pc)', price: 80 },
          { name: 'Omelette (double)', price: 50 },
          { name: 'Haser Dim Curry (2 pc)', price: 150 },
          { name: 'Haser Dim Kosha (2 pc)', price: 180 },
          { name: 'Katla Curry (2 pc)', price: 240 },
          { name: 'Katla Kalia (2 pc)', price: 280 },
          { name: 'Katla Fry (2 pc)', price: 210 },
          { name: 'Pabda Sorshe (2 pc)', price: 340 },
          { name: 'Mourala Macher Jhal', price: 130 },
          { name: 'Sorshe Elish (2 pc)', price: 800 },
          { name: 'Chingri Malaikari (2 pc)', price: 360 },
          { name: 'Pomfret Jhal (2 pc)', price: 360 },
          { name: 'Pomfret Fry (2 pc)', price: 340 },
          { name: 'Deshi Chicken (4 pc)', price: 450 },
          { name: 'Chicken Curry (4 pc)', price: 220 },
          { name: 'Chicken Kosha (4 pc)', price: 250 },
          { name: 'Chicken Dakbunglow (4 pc)', price: 320 },
          { name: 'Dhania Chicken (4 pc)', price: 260 },
          { name: 'Mutton Kosha (4 pc)', price: 390 },
          { name: 'Mutton Curry (4 pc)', price: 350 },
          { name: 'Mutton Dakbunglow (4 pc)', price: 400 },
          { name: 'Egg Tadka', price: 140 },
          { name: 'Chicken Tadka', price: 160 },
          { name: 'Egg Chicken Tadka', price: 180 },
          { name: 'Pepper Chicken', price: 280 },
          { name: 'Fish with Onion & Cream', price: 340 },
          { name: 'Crab', price: 800 },
        ],
      },
    ],
  },
  {
    id: 'mixed',
    title: 'Mixed menu',
    groups: [
      {
        title: 'Choice of rice',
        items: [
          { name: 'Steam Rice', price: 80 },
          { name: 'Jeera Rice', price: 100 },
          { name: 'Veg Fried Rice', price: 130 },
          { name: 'Egg Fried Rice', price: 150 },
          { name: 'Chicken Fried Rice', price: 180 },
        ],
      },
      {
        title: 'Polao & roti',
        items: [
          { name: 'Basanti Polao', price: 150 },
          { name: 'Plain Polao', price: 120 },
          { name: 'Tawa Roti (1 pc)', price: 8 },
          { name: 'Plain Paratha', price: 20 },
          { name: 'Lachchha Paratha', price: 35 },
          { name: 'Gola Ruti', price: 30 },
        ],
      },
      {
        title: 'Chatni',
        items: [
          { name: 'Tomato Chatni', price: 60 },
          { name: 'Aamer Chatni', price: 60 },
          { name: 'Fruit Chatni', price: 80 },
          { name: 'Peper Chatni', price: 60 },
          { name: 'Dhanepatar Chatni', price: 50 },
          { name: 'Amsotto Khejur Chatni', price: 80 },
          { name: 'Mourola Macher Tok', price: 100 },
          { name: 'Machher Dimer Tok', price: 100 },
        ],
      },
    ],
  },
  {
    id: 'snacks',
    title: 'Snacks',
    groups: [
      {
        title: 'Veg & non-veg',
        items: [
          { name: 'Egg Pakora (6 pc)', price: 80 },
          { name: 'Sandwich (Veg)', price: 100 },
          { name: 'Sandwich (Cheese)', price: 150 },
          { name: 'Sandwich (Non-Veg)', price: 150 },
          { name: 'Bombay Sandwich', price: 120 },
          { name: 'Hot Dog', price: 170 },
          { name: 'Chilli Cheese Toast', price: 100 },
          { name: 'French Toast', price: 120 },
          { name: 'Burger (Veg)', price: 150 },
          { name: 'Burger (Non-Veg)', price: 200 },
          { name: 'Crispy Chicken (6 pc)', price: 180 },
          { name: 'Chicken Lollipop (4 pc)', price: 210 },
          { name: 'Crispy Chilli Baby Corn', price: 180 },
          { name: 'Cheese Garlic Toast', price: 130 },
          { name: 'Mocha Chop (4 pc)', price: 90 },
          { name: 'Mocha Chop (2 pc)', price: 50 },
          { name: 'Cheese Garlic Toast', price: 100 },
          { name: 'Onion Pakora (2 pc)', price: 60 },
          { name: 'French Fries', price: 100 },
          { name: 'Paneer Pakora (6 pc)', price: 150 },
          { name: 'Fish Fry Vetki (1 pc)', price: 150 },
          { name: 'Fish Finger Vetki (4 pc)', price: 180 },
          { name: 'Egg Devil (2 pc)', price: 150 },
          { name: 'Mutton Cutlet (1 pc)', price: 180 },
          { name: 'Chicken Cutlet (1 pc)', price: 120 },
          { name: 'Chicken 65 (6 pc)', price: 150 },
          { name: 'Gandhoraj Chicken Pakora (6 pc)', price: 180 },
          { name: 'Maggi (Veg)', price: 75 },
          { name: 'Maggi (Non-Veg)', price: 100 },
          { name: 'Fish & Chips', price: 200 },
          { name: 'Chowmein (Veg)', price: 100 },
          { name: 'Chowmein (Egg)', price: 120 },
          { name: 'Chowmein (Chicken)', price: 130 },
          { name: 'Chowmein (Mix)', price: 150 },
          { name: 'Chilli Chicken (6 pc) Gravy', price: 190 },
          { name: 'Chilli Chicken (6 pc) Dry', price: 170 },
          { name: 'Crispy Baby Corn', price: 160 },
          { name: 'Chicken Salt & Pepper', price: 170 },
          { name: 'Garlic Chicken (4 pc)', price: 190 },
          { name: 'Dimer Chop (1 pc)', price: 15 },
        ],
      },
    ],
  },
];
