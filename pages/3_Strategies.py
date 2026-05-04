import streamlit as st
from data_sources import FakeDataSource
st.set_page_config(page_title="Strategies", layout="wide")
ds = FakeDataSource()
st.title("⚔️ Strategies")
df = ds.get_strategies_stats()
st.dataframe(df)
selected = st.selectbox("Strategy", df.index)
st.write(f"Details: {df.loc[selected].to_dict()}")
