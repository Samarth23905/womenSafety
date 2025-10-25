# Flashmob Area Safety Predictor

This Python script analyzes locations stored in the MySQL database and predicts safety ratings based on user descriptions and existing ratings.

## Features

- Fetches location data from MySQL database
- Processes text descriptions using TF-IDF vectorization
- Predicts safety scores using RandomForest classifier
- Generates JSON output with:
  - Overall safety rating
  - Per-location predictions
  - Risk factors identified from text
  - Safe vs unsafe location counts

## Setup

1. Install required Python packages:

```bash
python -m pip install -r requirements.txt
```

2. Ensure MySQL connection details are correct in the script or set environment variables:
   - DB_HOST (default: localhost)
   - DB_USER (default: root)
   - DB_PASS (default: empty)
   - DB_NAME (default: women_safety)

## Usage

Run the script:

```bash
python predict_flashmob_safety.py
```

This will:
1. Connect to MySQL and fetch locations
2. Process text descriptions
3. Train a safety classifier
4. Generate predictions
5. Save results to `public/safety_predictions.json`

Optional arguments:
- `--output`: Specify custom output path (default: public/safety_predictions.json)

## Output Format

The script generates a JSON file with this structure:

```json
{
  "overall_rating": 3.5,
  "total_locations": 10,
  "safe_locations": 7,
  "unsafe_locations": 3,
  "risk_factors": ["isolated", "dark", "..."],
  "predictions": [
    {
      "id": 1,
      "location_name": "Example Park",
      "description": "...",
      "actual_rating": 4.0,
      "safety_score": 0.85,
      "predicted_label": "safe",
      "latitude": 12.34,
      "longitude": 56.78,
      "reporter_name": "Jane Doe",
      "created_at": "2023-..."
    }
  ],
  "status": "success"
}
```

## Note

The script requires at least 3 locations with valid ratings to make meaningful predictions. With fewer locations, it will fall back to simple averaging.