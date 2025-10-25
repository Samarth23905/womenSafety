from dotenv import load_dotenv
import os
import google.generativeai as genai
import sys

genai.configure(api_key="YOUR_GEMINI_API_KEY")



load_dotenv()

api_key = os.getenv("GEMINI_SECRET_KEY")
genai.configure(api_key=api_key)

message = sys.argv[1] if len(sys.argv) > 1 else "Hello"
user_type = sys.argv[2] if len(sys.argv) > 2 else "Student"

model = genai.GenerativeModel("models/gemini-2.5-pro")
prompt = f"{user_type} says: {message}"

try:
    response = model.generate_content(prompt)
    print(response.text.strip())
except Exception as e:
    print("⚠️ Error while generating content:", e)