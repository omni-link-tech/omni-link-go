import requests

API = 'http://localhost:3000/api/place'

# Map string colors to numeric values
COLOR_MAP = {
    "black": 1,
    "white": 2
}

def place(intersection: str, color: str) -> None:
    color_num = COLOR_MAP.get(color.lower())
    if not color_num:
        raise ValueError(f"Invalid color: {color}. Must be 'black' or 'white'.")
    
    r = requests.post(API, json={'intersection': intersection, 'color': color_num})
    print(f"Placing {color} ({color_num}) at {intersection}")
    print(r.json())

if __name__ == '__main__':
    # example: place white stone at D6
    place('D6', 'white')
