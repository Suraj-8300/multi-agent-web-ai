import requests

API_KEY = "AIzaSyCz9mxtLatBJf1CGddir-l6l-DokAdmymc"

url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key={API_KEY}"

data = {
    "contents": [
        {
            "parts": [
                {"text": "Say hello in one sentence"}
            ]
        }
    ]
}

response = requests.post(url, json=data)

print("Status Code:", response.status_code)
print("hello")
print("Response:", response.text)
# Add this inside your main function to see your work
#print(research_graph.mermaid_code(start_node=PlannerNode))