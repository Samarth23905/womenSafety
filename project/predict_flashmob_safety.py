import os
import json
import argparse
from typing import List, Dict, Any
import warnings
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()
warnings.filterwarnings('ignore')

import pandas as pd
import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import cross_val_score
import mysql.connector
from mysql.connector import Error

def get_db_connection():
    """Create MySQL database connection using environment variables"""
    try:
        conn = mysql.connector.connect(
            host=os.getenv('DB_HOST', 'localhost'),
            user=os.getenv('DB_USER', 'root'),
            password=os.getenv('DB_PASS', ''),
            database=os.getenv('DB_NAME', 'women_safety')
        )
        return conn
    except Error as e:
        print(f"Error connecting to MySQL: {e}")
        return None

def fetch_locations() -> List[Dict[str, Any]]:
    """Fetch all locations from the database"""
    conn = get_db_connection()
    if not conn:
        return []
    
    try:
        cursor = conn.cursor(dictionary=True)
        query = """
        SELECT l.*, u.name as reporter_name 
        FROM locations l 
        LEFT JOIN users u ON l.created_by = u.id
        """
        cursor.execute(query)
        locations = cursor.fetchall()
        return locations
    except Error as e:
        print(f"Error fetching locations: {e}")
        return []
    finally:
        if conn.is_connected():
            cursor.close()
            conn.close()

def process_text(row: Dict[str, Any]) -> str:
    """Combine location details into a single text string"""
    parts = []
    for field in ['location_name', 'description', 'surrounding']:
        value = row.get(field)
        if value and pd.notnull(value):
            parts.append(str(value).strip())
    return ' . '.join(parts) if parts else 'No description available'

def analyze_safety(locations: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Analyze location safety using ML/NLP:
    1. Convert text descriptions to TF-IDF features
    2. Use ratings to create safety labels
    3. Train RandomForest classifier
    4. Predict safety scores and labels
    """
    if not locations:
        return {
            'overall_rating': None,
            'predictions': [],
            'status': 'error',
            'message': 'No location data available'
        }

    # Convert to DataFrame
    df = pd.DataFrame(locations)
    
    # Process text features
    df['text'] = df.apply(process_text, axis=1)
    
    # Convert ratings to numeric, dropping any non-numeric ratings
    df['rating_num'] = pd.to_numeric(df['rating'], errors='coerce')
    df = df.dropna(subset=['rating_num'])
    
    # Simple prediction for very small datasets (less than 3 samples)
    if len(df) < 3:
        predictions = []
        for _, row in df.iterrows():
            rating = float(row['rating_num'])
            safety_score = rating / 5.0  # Normalize to 0-1
            pred = {
                'id': int(row['id']) if pd.notnull(row['id']) else None,
                'location_name': row['location_name'],
                'description': row.get('description', ''),
                'surrounding': row.get('surrounding', ''),
                'actual_rating': rating,
                'safety_score': safety_score,
                'predicted_label': 'safe' if rating >= 3 else 'unsafe',
                'latitude': float(row['latitude']) if pd.notnull(row['latitude']) else None,
                'longitude': float(row['longitude']) if pd.notnull(row['longitude']) else None,
                'reporter_name': row.get('reporter_name', 'Anonymous'),
                'created_at': str(row['created_at']) if pd.notnull(row['created_at']) else None
            }
            predictions.append(pred)
        
        # Sort by safety score
        predictions.sort(key=lambda x: x['safety_score'])
        
        return {
            'overall_rating': float(df['rating_num'].mean()),
            'total_locations': len(predictions),
            'safe_locations': sum(1 for p in predictions if p['predicted_label'] == 'safe'),
            'unsafe_locations': sum(1 for p in predictions if p['predicted_label'] == 'unsafe'),
            'risk_factors': [],  # No risk factors with small dataset
            'predictions': predictions,
            'status': 'success',
            'note': 'Using simple rating-based prediction due to small dataset'
        }

    # Create features
    vectorizer = TfidfVectorizer(
        max_features=100,
        ngram_range=(1, 2),
        stop_words='english'
    )
    X = vectorizer.fit_transform(df['text'])
    
    # Create safety labels (safe if rating >= 3)
    y = (df['rating_num'] >= 3).astype(int)
    
    # Train model
    clf = RandomForestClassifier(n_estimators=50, random_state=42)
    clf.fit(X, y)
    
    # Get feature importance words
    feature_importance = pd.DataFrame({
        'term': vectorizer.get_feature_names_out(),
        'importance': clf.feature_importances_
    }).sort_values('importance', ascending=False)
    
    # Make predictions
    safety_probs = clf.predict_proba(X)[:, 1]
    predictions = []
    
    for idx, row in df.iterrows():
        pred = {
            'id': int(row['id']) if pd.notnull(row['id']) else None,
            'location_name': row['location_name'],
            'description': row.get('description', ''),
            'surrounding': row.get('surrounding', ''),
            'actual_rating': float(row['rating_num']),
            'safety_score': float(safety_probs[idx]),
            'predicted_label': 'safe' if safety_probs[idx] >= 0.5 else 'unsafe',
            'latitude': float(row['latitude']) if pd.notnull(row['latitude']) else None,
            'longitude': float(row['longitude']) if pd.notnull(row['longitude']) else None,
            'reporter_name': row.get('reporter_name', 'Anonymous'),
            'created_at': str(row['created_at']) if pd.notnull(row['created_at']) else None
        }
        predictions.append(pred)
    
    # Sort by safety score (most unsafe first)
    predictions.sort(key=lambda x: x['safety_score'])
    
    # Calculate overall metrics
    overall_rating = float(df['rating_num'].mean())
    safe_locations = sum(1 for p in predictions if p['predicted_label'] == 'safe')
    unsafe_locations = len(predictions) - safe_locations
    
    # Get top risk factors from feature importance
    risk_factors = feature_importance.head(5)['term'].tolist()
    
    return {
        'overall_rating': overall_rating,
        'total_locations': len(predictions),
        'safe_locations': safe_locations,
        'unsafe_locations': unsafe_locations,
        'risk_factors': risk_factors,
        'predictions': predictions,
        'status': 'success'
    }

def main():
    parser = argparse.ArgumentParser(description='Analyze and predict safety of flashmob locations')
    parser.add_argument('--output', default='public/safety_predictions.json',
                      help='Output JSON file path (default: public/safety_predictions.json)')
    args = parser.parse_args()
    
    print("Fetching location data...")
    locations = fetch_locations()
    
    print("Analyzing safety...")
    results = analyze_safety(locations)
    
    # Ensure output directory exists
    os.makedirs(os.path.dirname(os.path.abspath(args.output)), exist_ok=True)
    
    print("Writing predictions to", args.output)
    with open(args.output, 'w', encoding='utf-8') as f:
        json.dump(results, f, indent=2, ensure_ascii=False)
    
    if results['status'] == 'success':
        print(f"\nAnalysis complete:")
        print(f"- Total locations analyzed: {results['total_locations']}")
        print(f"- Overall safety rating: {results['overall_rating']:.1f}/5.0")
        print(f"- Safe locations: {results['safe_locations']}")
        print(f"- Unsafe locations: {results['unsafe_locations']}")
        if results['risk_factors']:
            print("- Top risk factors:", ", ".join(results['risk_factors']))
    else:
        print("\nAnalysis failed:", results['message'])

if __name__ == '__main__':
    main()